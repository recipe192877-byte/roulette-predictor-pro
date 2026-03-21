from flask import Flask, request, jsonify
from flask_cors import CORS
from collections import Counter
import warnings
import math

warnings.filterwarnings("ignore")

app = Flask(__name__)
CORS(app)

ROULETTE_NUMBERS = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]

def get_wheel_distance(n1, n2):
    try:
        idx1 = ROULETTE_NUMBERS.index(n1)
        idx2 = ROULETTE_NUMBERS.index(n2)
        dist = abs(idx1 - idx2)
        return int(min(dist, 37 - dist))
    except (ValueError, TypeError):
        return 18

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data"}), 400
            
        spins = data.get('spins', [])
        
        if not spins or len(spins) < 5:
            return jsonify({"error": "Insufficient data. Need at least 5 spins."}), 400
            
        recent_15 = spins[-15:]
        older_35 = spins[-50:-15]
        
        counts_15 = Counter(recent_15)
        counts_older = Counter(older_35)
        
        last_num = spins[-1]
        
        scores = []
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
            scores.append((i, sc))
            
        scores.sort(key=lambda x: float(x[1]), reverse=True)
        top_3 = [int(s[0]) for s in scores[:3]]
        
        return jsonify({
            "status": "success",
            "model": "Roulette_Math_Ensemble_v2",
            "predictions": top_3,
            "confidence": round(float(scores[0][1]), 2)
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
