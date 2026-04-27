from flask import Flask, request, jsonify
from flask_cors import CORS
from collections import Counter
import warnings
import math
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.neural_network import MLPClassifier
from xgboost import XGBClassifier
import lightgbm as lgb
from sklearn.preprocessing import LabelEncoder

warnings.filterwarnings("ignore")

app = Flask(__name__)
CORS(app)


ROULETTE_NUMBERS = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]
RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]

VOISINS = [22,18,29,7,28,12,35,3,26,0,32,15,19,4,21,2,25]
TIERS = [27,13,36,11,30,8,23,10,5,24,16,33]
ORPHELINS = [1,20,14,31,9,17,34,6]

def get_wheel_distance(n1, n2):
    try:
        idx1 = ROULETTE_NUMBERS.index(n1)
        idx2 = ROULETTE_NUMBERS.index(n2)
        dist = abs(idx1 - idx2)
        return int(min(dist, 37 - dist))
    except:
        return 18

def get_sector(n):
    if n in VOISINS: return 1
    elif n in TIERS: return 2
    elif n in ORPHELINS: return 3
    return 0

def get_delay(num, history):
    """Returns how many spins AGO the number last appeared. 0 = just appeared."""
    if num in history:
        for i in range(len(history) - 1, -1, -1):
            if history[i] == num:
                return len(history) - 1 - i
    return len(history) + 10  # Never seen = large delay

def get_features(spin_history):
    features = []
    for i in range(len(spin_history)):
        val = spin_history[i]
        
        is_red = 1 if val in RED_NUMBERS else (0 if val == 0 else -1)
        is_even = 1 if (val % 2 == 0 and val != 0) else (0 if val == 0 else -1)
        is_high = 1 if val >= 19 else (-1 if val >= 1 else 0)
        
        dozen = 0
        if 1 <= val <= 12: dozen = 1
        elif 13 <= val <= 24: dozen = 2
        elif 25 <= val <= 36: dozen = 3
            
        col = 0
        if val != 0:
            if val % 3 == 1: col = 1
            elif val % 3 == 2: col = 2
            elif val % 3 == 0: col = 3
                
        dist_prev = 0
        if i > 0:
            dist_prev = get_wheel_distance(spin_history[i], spin_history[i-1])

        dist_prev2 = 0
        if i > 1:
            dist_prev2 = get_wheel_distance(spin_history[i], spin_history[i-2])
            
        sector = get_sector(val)
        
        past = spin_history[:i]
        delay = get_delay(val, past)
            
        roll_seq = past[-5:] if len(past) >= 5 else past
        roll_avg = sum(roll_seq) / len(roll_seq) if roll_seq else 18.0
        roll_std = float(np.std(roll_seq)) if len(roll_seq) >= 2 else 0.0
        
        # Color streak length
        streak = 0
        if is_red == 1 or is_red == -1:
            for s in reversed(past):
                prev_is_red = 1 if s in RED_NUMBERS else (0 if s == 0 else -1)
                if prev_is_red == is_red:
                    streak += 1
                else: break
                
        dist_to_zero = get_wheel_distance(val, 0)
        
        # Hot zone: count of nearby wheel neighbors in last 10
        hot_zone = 0
        recent_10 = past[-10:]
        for r in recent_10:
            if get_wheel_distance(val, r) <= 3:
                hot_zone += 1
        
        # Sector streak: how many of last 5 were in same sector
        sector_streak = 0
        for s in reversed(past[-5:]):
            if get_sector(s) == sector:
                sector_streak += 1
            else:
                break
            
        features.append([
            val, is_red, is_even, is_high, dozen, col,
            dist_prev, dist_prev2, sector, delay, 
            roll_avg, roll_std, streak, dist_to_zero,
            hot_zone, sector_streak
        ])
    return np.array(features)

def calculate_math_scores(spins):
    recent_15 = spins[-15:]
    older = spins[:-15] if len(spins) > 15 else []
    
    counts_15 = Counter(recent_15)
    counts_older = Counter(older)
    
    last_num = spins[-1] if spins else None
    prev_num = spins[-2] if len(spins) > 1 else None
    
    scores = {}
    
    # Markov Chain Transition Matrix
    transition_weights = {i: 0.0 for i in range(37)}
    
    # Tri-gram Markov
    if len(spins) >= 3:
        for j in range(len(spins)-2):
            if spins[j] == prev_num and spins[j+1] == last_num:
                target = spins[j+2] if j+2 < len(spins) else None
                if target is not None:
                    transition_weights[target] += 12.0
                
    if len(spins) >= 2:
        for j in range(len(spins)-1):
            if spins[j] == last_num:
                target = spins[j+1]
                transition_weights[target] += 8.0
                left_n = ROULETTE_NUMBERS[(ROULETTE_NUMBERS.index(target) - 1) % 37]
                right_n = ROULETTE_NUMBERS[(ROULETTE_NUMBERS.index(target) + 1) % 37]
                transition_weights[left_n] += 3.5
                transition_weights[right_n] += 3.5

    # Sector momentum
    recent_sectors = [get_sector(s) for s in recent_15]
    sector_counts = Counter(recent_sectors)
    hot_sector = sector_counts.most_common(1)[0][0] if sector_counts else 0

    for i in range(37):
        momentum = float(counts_15.get(i, 0) * 5.5) + float(counts_older.get(i, 0) * 1.0)
        
        delay = get_delay(i, spins)
        due_score = 0.0
        if 25 <= delay <= 40:
            due_score = 3.5
        elif 40 < delay <= 60:
            due_score = 1.5  # Cooling down
        elif delay > 60:
            due_score = -2.0
            
        sector_bonus = 2.0 if get_sector(i) == hot_sector else 0.0
            
        neighbor_score = 0.0
        for r in recent_15[-5:]:
            dist = get_wheel_distance(i, r)
            if dist <= 2:
                neighbor_score += 2.5
            elif dist <= 4:
                neighbor_score += 1.0
                
        markov = transition_weights[i]
                
        scores[i] = momentum + due_score + sector_bonus + neighbor_score + markov
        if scores[i] < 0: scores[i] = 0.1
        
    return scores

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data"}), 400
            
        spins = data.get('spins', [])
        
        if not spins or len(spins) < 5:
            return jsonify({"error": "Insufficient data. Need at least 5 spins."}), 400
            
        # 1. Math Model
        math_scores = calculate_math_scores(spins)
        total_math = sum(math_scores.values()) + 1e-9
        math_probs = {k: v/total_math for k, v in math_scores.items()}
        
        # Initialize all 37 numbers with base probability
        final_probs = {i: math_probs.get(i, 1/37) * 0.4 for i in range(37)}
        confidence_multiplier = 1.0
        model_used = "Math_Markov_Matrix_v3"
        
        # 2. ML Ensemble
        if len(spins) >= 15:
            model_used = "Deep_Hybrid_AI (LGBM+XGB+RF+MLP+GB)"
            try:
                X = get_features(spins)
                X_train = X[:-1]
                y_train = spins[1:]
                
                if len(set(y_train)) > 1:
                    le = LabelEncoder()
                    y_encoded = le.fit_transform(y_train)
                    all_classes = le.classes_
                    
                    rf = RandomForestClassifier(n_estimators=150, random_state=42, max_depth=5, min_samples_leaf=1)
                    rf.fit(X_train, y_train)
                    
                    xgb = XGBClassifier(n_estimators=100, max_depth=3, learning_rate=0.08, min_child_weight=1, gamma=0.2, eval_metric='mlogloss', verbosity=0, random_state=42)
                    xgb.fit(X_train, y_encoded)
                    
                    mlp = MLPClassifier(hidden_layer_sizes=(64, 32), max_iter=300, random_state=42)
                    mlp.fit(X_train, y_train)
                    
                    lgbm = lgb.LGBMClassifier(n_estimators=100, max_depth=3, learning_rate=0.08, random_state=42, verbose=-1, min_child_samples=2)
                    lgbm.fit(X_train, y_encoded)
                    
                    gb = GradientBoostingClassifier(n_estimators=100, learning_rate=0.08, max_depth=3, random_state=42)
                    gb.fit(X_train, y_encoded)
                    
                    X_test = X[-1].reshape(1, -1)
                    
                    # Safe probability extraction for all models
                    def safe_add_probs(model, X_test, weight, use_le=False, model_classes=None):
                        probs = model.predict_proba(X_test)[0]
                        classes = model_classes if model_classes is not None else model.classes_
                        for idx, cls in enumerate(classes):
                            real_cls = int(le.classes_[cls]) if use_le else int(cls)
                            if 0 <= real_cls <= 36:
                                final_probs[real_cls] = final_probs.get(real_cls, 0) + probs[idx] * weight
                    
                    safe_add_probs(rf, X_test, 0.12, use_le=False)
                    safe_add_probs(xgb, X_test, 0.12, use_le=True)
                    safe_add_probs(mlp, X_test, 0.12, use_le=False)
                    safe_add_probs(lgbm, X_test, 0.12, use_le=True)
                    safe_add_probs(gb, X_test, 0.12, use_le=True)
                    
                    confidence_multiplier = 2.8
            except Exception as ml_e:
                print("ML Warning:", ml_e)
                for i in range(37):
                    final_probs[i] = math_probs.get(i, 1/37)
                
        # 3. Results
        sorted_preds = sorted(final_probs.items(), key=lambda x: x[1], reverse=True)
        top_3 = [int(p[0]) for p in sorted_preds[:3]]
        
        top_score = min(sorted_preds[0][1] * 100 * confidence_multiplier, 99.9)
        
        if top_score < 14.0:
            status_label = "WAIT"
        elif top_score < 24.0:
            status_label = "LOW"
        elif top_score < 38.0:
            status_label = "GOOD"
        else:
            status_label = "HIGH"
            
        return jsonify({
            "status": "success",
            "model": model_used,
            "predictions": top_3,
            "confidence": round(top_score, 2),
            "signal": status_label
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/status', methods=['GET'])
def status():
    return jsonify({"status": "online"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
