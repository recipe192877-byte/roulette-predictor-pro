from flask import Flask, request, jsonify
from flask_cors import CORS
from collections import Counter
import warnings
import math
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from xgboost import XGBClassifier

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
    if num in history:
        # Distance from end
        return len(history) - 1 - list(reversed(history)).index(num)
    return len(history)

def get_features(spin_history):
    features = []
    for i in range(len(spin_history)):
        val = spin_history[i]
        
        is_red = 1 if val in RED_NUMBERS else (0 if val == 0 else -1)
        is_even = 1 if (val % 2 == 0 and val != 0) else (0 if val == 0 else -1)
        
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
            
        sector = get_sector(val)
        
        # Calculate delay at this point in time
        past = spin_history[:i]
        delay = get_delay(val, past)
            
        features.append([val, is_red, is_even, dozen, col, dist_prev, sector, delay])
    return np.array(features)

def calculate_math_scores(spins):
    recent_15 = spins[-15:]
    older = spins[:-15] if len(spins) > 15 else []
    
    counts_15 = Counter(recent_15)
    counts_older = Counter(older)
    
    last_num = spins[-1] if spins else None
    prev_num = spins[-2] if len(spins) > 1 else None
    
    scores = {}
    
    # 1. Markov Chain Transition Matrix
    transition_weights = {i: 0.0 for i in range(37)}
    if len(spins) >= 2:
        for j in range(len(spins)-1):
            if spins[j] == last_num:
                target = spins[j+1]
                transition_weights[target] += 5.0  # Strong transition link
                # Neighbor spillover
                left_n = ROULETTE_NUMBERS[(ROULETTE_NUMBERS.index(target) - 1) % 37]
                right_n = ROULETTE_NUMBERS[(ROULETTE_NUMBERS.index(target) + 1) % 37]
                transition_weights[left_n] += 2.0
                transition_weights[right_n] += 2.0

    # Sector momentum
    recent_sectors = [get_sector(s) for s in recent_15]
    sector_counts = Counter(recent_sectors)
    hot_sector = sector_counts.most_common(1)[0][0] if sector_counts else 0

    for i in range(37):
        # Base Momentum
        momentum = float(counts_15.get(i, 0) * 4.0) + float(counts_older.get(i, 0) * 1.5)
        
        # Delay Mechanics (Law of Thirds optimization)
        delay = get_delay(i, spins)
        due_score = 0.0
        if 25 <= delay <= 40:
            due_score = 3.5  # Sweet spot for sleeping numbers to wake up
        elif delay > 60:
            due_score = -2.0 # Truly cold, avoid
            
        # Sector Bonus
        sector_bonus = 0.0
        if get_sector(i) == hot_sector:
            sector_bonus = 2.0
            
        # Wheel Neighbor proximity to recent hits
        neighbor_score = 0.0
        for r in recent_15[-3:]:
            if get_wheel_distance(i, r) <= 2:
                neighbor_score += 1.5
                
        # Markov Chain Transition
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
            
        # 1. Advanced Math Model with Markov Chains
        math_scores = calculate_math_scores(spins)
        
        total_math = sum(math_scores.values()) + 1e-9
        math_probs = {k: v/total_math for k, v in math_scores.items()}
        
        final_probs = {i: math_probs[i] * 0.4 for i in range(37)} # Base math weight 40%
        confidence_multiplier = 1.0
        model_used = "Math_Markov_Matrix_v3"
        
        # 2. Strict ML Online Learning Phase
        if len(spins) >= 15:
            model_used = "Hybrid_AI (XGB+RF+Markov)"
            try:
                X = get_features(spins)
                X_train = X[:-1]
                y_train = spins[1:]
                
                if len(set(y_train)) > 1:
                    rf = RandomForestClassifier(n_estimators=150, random_state=42, max_depth=5, min_samples_leaf=1)
                    rf.fit(X_train, y_train)
                    
                    xgb = XGBClassifier(
                        n_estimators=100, 
                        max_depth=3, 
                        learning_rate=0.08, 
                        min_child_weight=1, 
                        gamma=0.2, 
                        use_label_encoder=False, 
                        eval_metric='mlogloss', 
                        random_state=42
                    )
                    xgb.fit(X_train, y_train)
                    
                    # Target Feature row: predicting using LAST spin's state
                    X_test = X[-1].reshape(1, -1)
                    
                    rf_probs = rf.predict_proba(X_test)[0]
                    xgb_probs = xgb.predict_proba(X_test)[0]
                    
                    for idx, cls in enumerate(rf.classes_):
                        final_probs[cls] += rf_probs[idx] * 0.3  # 30% RF Weight
                        
                    for idx, cls in enumerate(xgb.classes_):
                        final_probs[cls] += xgb_probs[idx] * 0.3  # 30% XGB Weight
                        
                    confidence_multiplier = 1.8 
            except Exception as ml_e:
                print("ML Warning:", ml_e)
                # Fallback to Math if ML errors (e.g. single class issue)
                for i in range(37):
                    final_probs[i] = math_probs[i]
                
        # 3. Compile Final Results
        sorted_preds = sorted(final_probs.items(), key=lambda x: x[1], reverse=True)
        top_3 = [int(p[0]) for p in sorted_preds[:3]]
        
        # UI Scaling 1 to 10 scale
        top_score = min(sorted_preds[0][1] * 100 * confidence_multiplier, 99.9)
        
        # Determine strict confidence label
        if top_score < 15.0:
            status_label = "WAIT"
        elif 15.0 <= top_score < 25.0:
            status_label = "LOW"
        elif 25.0 <= top_score < 40.0:
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
