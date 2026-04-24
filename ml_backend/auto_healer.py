"""
AutoHealer v3.0 — Autonomous AI Code Maintenance System
- Uses google-genai SDK (official, non-deprecated)
- Auto-retry on rate limit (429) with exponential backoff
- Multi-model fallback chain: 2.0-flash → 1.5-flash → 1.5-pro
- Syntax validation before overwriting files
- Truncation detection (rejects incomplete AI outputs)
- Structural integrity check (rejects outputs missing key classes/functions)
- Full diagnostic logging to ai_backups/heal_log.txt
"""
import os
import sys
import time
import json
import shutil
import threading
import ast
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Models to try in order (cheapest first, each has separate quota)
MODELS_TO_TRY = [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-2.0-flash-lite",
]

MAX_RETRIES = 3
RETRY_BASE_WAIT = 25  # seconds


class AutoHealer:
    def __init__(self):
        load_dotenv()
        self.api_key = os.getenv("GEMINI_API_KEY")
        self.is_configured = False
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.backup_dir = os.path.join(self.base_dir, "ai_backups")
        self.state_file = os.path.join(self.backup_dir, "last_scan.json")
        self.log_file = os.path.join(self.backup_dir, "heal_log.txt")
        self._client = None
        
        if not os.path.exists(self.backup_dir):
            os.makedirs(self.backup_dir)
            
        if self.api_key and self.api_key != "your_api_key_here":
            try:
                from google import genai
                self._client = genai.Client(api_key=self.api_key)
                self.is_configured = True
                self._log("AutoHealer v3.0 initialized (google-genai SDK).")
            except ImportError:
                self._log("ERROR: google-genai package not installed. Run: pip install google-genai")
            except Exception as e:
                self._log(f"AutoHealer init error: {e}")
        else:
            self._log("AutoHealer: GEMINI_API_KEY not found in .env file.")
    
    def _log(self, message):
        """Write to heal_log.txt for troubleshooting."""
        try:
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with open(self.log_file, 'a', encoding='utf-8') as f:
                f.write(f"[{ts}] {message}\n")
        except Exception:
            pass

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
            self._log(f"State write error: {e}")

    def _backup_file(self, filepath):
        if not os.path.exists(filepath):
            return False
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = os.path.basename(filepath)
        backup_path = os.path.join(self.backup_dir, f"{filename}.{timestamp}.bak")
        try:
            shutil.copy2(filepath, backup_path)
            self._log(f"Backup: {backup_path}")
            return True
        except Exception as e:
            self._log(f"Backup failed: {e}")
            return False

    def _validate_python(self, code, filename):
        """Validate that AI-generated code is actually valid Python."""
        if not filename.endswith('.py'):
            return True
        try:
            ast.parse(code)
            return True
        except SyntaxError as e:
            self._log(f"REJECTED fix for {filename}: SyntaxError line {e.lineno}: {e.msg}")
            return False

    def _call_gemini(self, prompt, ui_callback=None):
        """Call Gemini API with retry + multi-model fallback."""
        if not self._client:
            raise RuntimeError("Gemini client not initialized")
        
        last_error = None
        
        for model_name in MODELS_TO_TRY:
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    response = self._client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                    )
                    self._log(f"API success: model={model_name}, attempt={attempt}")
                    return response.text.strip()
                    
                except Exception as e:
                    last_error = e
                    error_str = str(e)
                    
                    if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
                        # Rate limit — wait and retry, then try next model
                        wait_time = RETRY_BASE_WAIT * attempt
                        self._log(f"Rate limited on {model_name} (attempt {attempt}/{MAX_RETRIES}). Waiting {wait_time}s...")
                        if ui_callback:
                            ui_callback(f"⏳ Rate limited ({model_name}). Retrying in {wait_time}s... ({attempt}/{MAX_RETRIES})")
                        time.sleep(wait_time)
                    elif "404" in error_str or "NOT_FOUND" in error_str:
                        # Model not available — skip to next model immediately
                        self._log(f"Model {model_name} not available, trying next...")
                        break
                    else:
                        # Unknown error — log and retry
                        self._log(f"API error on {model_name}: {error_str[:200]}")
                        if attempt < MAX_RETRIES:
                            time.sleep(5)
                        else:
                            break
            
            # If we exhausted retries on this model, try next model
            self._log(f"All retries exhausted for {model_name}, trying next model...")
        
        # All models and retries failed
        error_msg = str(last_error)[:200] if last_error else "Unknown"
        
        if "RESOURCE_EXHAUSTED" in error_msg or "429" in error_msg:
            raise RuntimeError(
                "API QUOTA EXHAUSTED - Aapki Free Tier API key ki daily limit khatam ho gayi hai. "
                "Fix: Google Cloud Console > Billing enable karein. "
                "Link: https://console.cloud.google.com/billing"
            )
        raise RuntimeError(f"All API calls failed: {error_msg}")

    def scan_and_fix_file(self, filepath, ui_callback):
        if not os.path.exists(filepath):
            msg = f"File not found: {os.path.basename(filepath)}"
            ui_callback(f"⚠️ AutoHealer: {msg}")
            self._log(msg)
            return False

        filename = os.path.basename(filepath)
        ui_callback(f"🔍 AutoHealer scanning {filename}...")
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                original_code = f.read()

            prompt = f"""You are an autonomous AI code healer. Analyze this Python file for CRITICAL bugs only:
- Runtime crashes (NameError, TypeError, IndexError)
- Logic errors that produce wrong results
- Memory leaks or infinite loops
- Missing error handling that will cause crashes

File: {filename}

{original_code}

RULES:
1. If the code is generally fine (no critical bugs), reply ONLY with: NO_BUGS
2. If you find critical bugs, return the COMPLETE corrected Python code.
3. Do NOT use markdown fences. Return raw Python code only.
4. Do NOT change code style, comments, or make cosmetic changes.
5. Only fix CRITICAL bugs, not minor improvements."""

            result = self._call_gemini(prompt, ui_callback)
            
            # Strip markdown fences if AI ignores instructions
            if result.startswith("```python"):
                result = result[9:]
            elif result.startswith("```"):
                result = result[3:]
            if result.endswith("```"):
                result = result[:-3]
            result = result.strip()

            # Check 1: NO_BUGS response
            if "NO_BUGS" in result or len(result) < 50:
                ui_callback(f"✅ {filename}: Clean - no bugs found.")
                self._log(f"{filename}: NO_BUGS")
                return False

            # Check 2: Valid Python syntax
            if not self._validate_python(result, filename):
                ui_callback(f"⚠️ {filename}: AI returned invalid code. Fix REJECTED.")
                return False

            # Check 3: Not truncated (AI response should be at least 50% of original)
            if len(result) < len(original_code) * 0.5:
                msg = f"{filename}: AI response truncated ({len(result)} vs {len(original_code)} chars). REJECTED."
                ui_callback(f"⚠️ {msg}")
                self._log(msg)
                return False

            # Check 4: Key structures preserved
            try:
                orig_tree = ast.parse(original_code)
                fixed_tree = ast.parse(result)
                orig_names = {n.name for n in ast.walk(orig_tree) 
                              if isinstance(n, (ast.ClassDef, ast.FunctionDef))}
                fixed_names = {n.name for n in ast.walk(fixed_tree) 
                               if isinstance(n, (ast.ClassDef, ast.FunctionDef))}
                missing = orig_names - fixed_names
                if len(missing) > 2:
                    msg = f"{filename}: AI removed {len(missing)} functions/classes. REJECTED."
                    ui_callback(f"⚠️ {msg}")
                    self._log(f"{msg} Missing: {missing}")
                    return False
            except Exception:
                pass

            # All checks passed — apply fix
            ui_callback(f"🛠️ Found issues in {filename}. Applying fix...")
            
            if self._backup_file(filepath):
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(result)
                msg = f"✨ {filename}: HEALED successfully (backup saved)."
                ui_callback(msg)
                self._log(msg)
                return True
            else:
                msg = f"❌ {filename}: Backup failed. Fix aborted for safety."
                ui_callback(msg)
                self._log(msg)
                return False

        except RuntimeError as e:
            # Clear error from _call_gemini (quota, etc.)
            ui_callback(f"⚠️ {str(e)}")
            self._log(str(e))
            return False
        except Exception as e:
            msg = f"AutoHealer error on {filename}: {str(e)[:120]}"
            ui_callback(f"⚠️ {msg}")
            self._log(msg)
            return False

    def run_daily_maintenance(self, file_list, ui_callback, force=False):
        if not self.is_configured:
            ui_callback("⚠️ AutoHealer: GEMINI_API_KEY not set in .env file.")
            self._log("Skipped: No API key.")
            return

        if not force and not self._should_run_scan():
            self._log("Skipped: Last scan < 24 hours ago.")
            return

        def task():
            ui_callback("🚀 AutoHealer: Starting full project scan...")
            self._log(f"=== Maintenance Started (force={force}) ===")
            fixes_applied = 0
            errors = 0
            
            for file_path in file_list:
                if os.path.isabs(file_path):
                    full_path = file_path
                else:
                    full_path = os.path.join(self.base_dir, file_path)
                try:
                    if self.scan_and_fix_file(full_path, ui_callback):
                        fixes_applied += 1
                except Exception as e:
                    errors += 1
                    self._log(f"Unexpected: {e}")
                time.sleep(5)  # 5 sec gap between files for rate limit safety
                
            self._update_scan_time()
            
            if fixes_applied > 0:
                msg = f"🏁 Scan complete. Fixed {fixes_applied} file(s)."
            elif errors > 0:
                msg = f"🏁 Scan done with {errors} error(s). Check ai_backups/heal_log.txt"
            else:
                msg = "🏁 Scan complete. All files healthy!"
            ui_callback(msg)
            self._log(msg)

        thread = threading.Thread(target=task, daemon=True)
        thread.start()
