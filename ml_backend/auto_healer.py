import os
import time
import json
import shutil
import threading
from datetime import datetime, timedelta
from dotenv import load_dotenv
import google.generativeai as genai

class AutoHealer:
    def __init__(self):
        load_dotenv()
        self.api_key = os.getenv("GEMINI_API_KEY")
        self.is_configured = False
        self.backup_dir = os.path.join(os.path.dirname(__file__), "ai_backups")
        self.state_file = os.path.join(self.backup_dir, "last_scan.json")
        
        if not os.path.exists(self.backup_dir):
            os.makedirs(self.backup_dir)
            
        if self.api_key and self.api_key != "your_api_key_here":
            try:
                genai.configure(api_key=self.api_key)
                self.model = genai.GenerativeModel('gemini-1.5-pro',
                    system_instruction="You are an autonomous AI code healer. You will receive a Python script. Your job is to scan it for critical runtime bugs, logical flaws, or dangerous anti-patterns. If the code is generally fine, you MUST reply ONLY with the string 'NO_BUGS'. Do NOT return anything else. If you find a critical bug that needs fixing, you MUST return the COMPLETE, fully-corrected Python code for that file. DO NOT use markdown formatting (like ```python) in your corrected code response. Just return the raw code string, nothing else.")
                self.is_configured = True
            except Exception as e:
                print(f"[AutoHealer Config Error] {e}")

    def _should_run_scan(self):
        if not os.path.exists(self.state_file):
            return True
        try:
            with open(self.state_file, 'r') as f:
                data = json.load(f)
                last_time_str = data.get('last_scan_time')
                if last_time_str:
                    last_time = datetime.fromisoformat(last_time_str)
                    if datetime.now() - last_time > timedelta(hours=24):
                        return True
        except Exception:
            return True
        return False

    def _update_scan_time(self):
        try:
            with open(self.state_file, 'w') as f:
                json.dump({'last_scan_time': datetime.now().isoformat()}, f)
        except Exception as e:
            print(f"[AutoHealer State Error] {e}")

    def _backup_file(self, filepath):
        if not os.path.exists(filepath):
            return False
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = os.path.basename(filepath)
        backup_path = os.path.join(self.backup_dir, f"{filename}.{timestamp}.bak")
        try:
            shutil.copy2(filepath, backup_path)
            return True
        except Exception as e:
            print(f"[AutoHealer Backup Error] {e}")
            return False

    def scan_and_fix_file(self, filepath, ui_callback):
        if not os.path.exists(filepath):
            ui_callback(f"⚠️ AutoHealer: Could not find {os.path.basename(filepath)}")
            return False

        filename = os.path.basename(filepath)
        ui_callback(f"🔍 AutoHealer scanning {filename}...")
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                original_code = f.read()

            prompt = f"Please analyze this file: {filename}\n\n{original_code}"
            response = self.model.generate_content(prompt)
            result = response.text.strip()
            
            # Remove possible markdown fences if the AI hallucinates them despite instructions
            if result.startswith("```python"):
                result = result[9:]
            elif result.startswith("```"):
                result = result[3:]
            if result.endswith("```"):
                result = result[:-3]
            result = result.strip()

            if "NO_BUGS" in result or len(result) < 50:
                ui_callback(f"✅ AutoHealer: {filename} is clean.")
                return False

            ui_callback(f"🛠️ AutoHealer found issues in {filename}. Applying fix...")
            
            if self._backup_file(filepath):
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(result)
                ui_callback(f"✨ AutoHealer: Successfully healed {filename} (Backup saved).")
                return True
            else:
                ui_callback(f"❌ AutoHealer: Failed to create backup. Fix aborted for safety.")
                return False

        except Exception as e:
            print(f"[AutoHealer Error] {e}")
            ui_callback(f"⚠️ AutoHealer error on {filename}.")
            return False

    def run_daily_maintenance(self, file_list, ui_callback, force=False):
        if not self.is_configured:
            ui_callback("⚠️ AutoHealer: API Key not configured.")
            return

        if not force and not self._should_run_scan():
            # Silently pass if not forced and not time yet
            return

        def task():
            ui_callback("🚀 AutoHealer: Initiating full project scan...")
            fixes_applied = 0
            for file_path in file_list:
                full_path = os.path.join(os.path.dirname(__file__), file_path)
                if self.scan_and_fix_file(full_path, ui_callback):
                    fixes_applied += 1
                time.sleep(2) # Prevent rate limiting
                
            self._update_scan_time()
            if fixes_applied > 0:
                ui_callback(f"🏁 AutoHealer: Scan complete. Fixed {fixes_applied} files.")
            else:
                ui_callback("🏁 AutoHealer: Scan complete. 100% Health. No bugs found.")

        thread = threading.Thread(target=task, daemon=True)
        thread.start()
