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

def get_wheel_distance(n1, n2):
    try:
        idx1 = ROULETTE_NUMBERS.index(n1)
        idx2 = ROULETTE_NUMBERS.index(n2)
        dist = abs(idx1 - idx2)
        return int(min(dist, 37 - dist))
    except (ValueError, TypeError):
        return 18

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
            
        features.append([val, is_red, is_even, dozen, col, dist_prev])
    return np.array(features)

def calculate_math_scores(spins):
    recent_15 = spins[-15:]
    older = spins[:-15] if len(spins) > 15 else []
    
    counts_15 = Counter(recent_15)
    counts_older = Counter(older)
    
    last_num = spins[-1]
    
    scores = {}
    for i in range(37):
        momentum = float(counts_15.get(i, 0) * 3.0) + float(counts_older.get(i, 0) * 1.0)
        
        trans_score = 0.0
        for j in range(len(spins)-1):
            if spins[j] == last_num and spins[j+1] == i:
                trans_score += 5.0
        
        delay = 0
        if i in spins:
            delay = len(spins) - 1 - list(reversed(spins)).index(i)
        else:
            delay = len(spins)
        
        due_score = 0.0
        if 20 <= delay <= 45:
            due_score = 2.0
            
        sector_bonus = 0.0
        for r in recent_15[-5:]:
            if get_wheel_distance(i, r) <= 2:
                sector_bonus += 1.5
                
        sc = momentum + trans_score + due_score + sector_bonus
        scores[i] = sc
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
            
        # 1. Base Math Model
        math_scores = calculate_math_scores(spins)
        
        # Normalize math scores to pseudo-probabilities
        total_math = sum(math_scores.values()) + 1e-9
        math_probs = {k: v/total_math for k, v in math_scores.items()}
        
        final_probs = {i: math_probs[i] for i in range(37)}
        confidence_multiplier = 1.0
        model_used = "Roulette_Math_Ensemble_v2"
        
        # 2. Advanced ML Phase (Online Training)
        if len(spins) >= 15:
            model_used = "Ensemble: XGBoost + RandomForest + Math"
            try:
                X = get_features(spins)
                # Training data: Features up to N-1 predict the next spin
                X_train = X[:-1]
                y_train = spins[1:]
                
                # We need at least 2 classes to train a classifier
                if len(set(y_train)) > 1:
                    rf = RandomForestClassifier(n_estimators=100, random_state=42, max_depth=4, min_samples_leaf=2)
                    rf.fit(X_train, y_train)
                    
                    # XGBoost needs classes from 0 to num_classes-1, but our classes might not be contiguous
                    # So we use standard Scikit-Learn wrapper which handles labels automatically
                    xgb = XGBClassifier(n_estimators=80, max_depth=2, learning_rate=0.05, min_child_weight=2, gamma=0.1, use_label_encoder=False, eval_metric='mlogloss', random_state=42)
                    xgb.fit(X_train, y_train)
                    
                    # Predict next
                    X_test = X[-1].reshape(1, -1)
                    
                    rf_probs = rf.predict_proba(X_test)[0]
                    xgb_probs = xgb.predict_proba(X_test)[0]
                    
                    rf_classes = rf.classes_
                    xgb_classes = xgb.classes_
                    
                    # Blend ML probabilities with Math
                    for idx, cls in enumerate(rf_classes):
                        final_probs[cls] += rf_probs[idx] * 0.5  # Weight for RF
                        
                    for idx, cls in enumerate(xgb_classes):
                        final_probs[cls] += xgb_probs[idx] * 0.5  # Weight for XGB
                        
                    confidence_multiplier = 2.0  # ML boosts confidence scale
            except Exception as ml_e:
                print("ML Warning:", ml_e)
                # Fallback to pure math if ML fails
                pass
                
        # 3. Sort and Return
        sorted_preds = sorted(final_probs.items(), key=lambda x: x[1], reverse=True)
        top_3 = [int(p[0]) for p in sorted_preds[:3]]
        
        # Calculate a human-readable confidence score (1.0 to ~10.0 scale for UI)
        # Using the relative strength of the top prediction
        top_score = sorted_preds[0][1] * 100 * confidence_multiplier
        
        return jsonify({
            "status": "success",
            "model": model_used,
            "predictions": top_3,
            "confidence": round(top_score, 2)
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
