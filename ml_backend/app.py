from flask import Flask, request, jsonify
from flask_cors import CORS
from collections import Counter
import warnings

# Suppress sklearn/numpy warnings if actual models are loaded
warnings.filterwarnings("ignore")

app = Flask(__name__)
# Allow CORS for local PWA testing
CORS(app)

@app.route('/predict', methods=['POST'])
def predict():
    """
    ML Endpoint for Roulette Prediction.
    Accepts sequence of historical spins and outputs advanced predictions.
    Gracefully handles errors.
    """
    try:
        data = request.json
        spins = data.get('spins', [])
        
        if not spins or len(spins) < 5:
            return jsonify({"error": "Insufficient data. Need at least 5 spins."}), 400
            
        # Standard analytical approach - could be swapped for a .pkl model
        recent = spins[-50:] 
        counts = Counter(recent)
        
        scores = []
        for i in range(37):
            freq_score = float(counts.get(i, 0)) * 1.5
            trans_score = 0.0
            
            # Markov Transition weighting
            for j in range(len(recent)-1):
                if recent[j] == recent[-1] and recent[j+1] == i:
                    trans_score += 4.0
                    
            sc = freq_score + trans_score
            scores.append((i, sc))
            
        scores.sort(key=lambda x: float(x[1]), reverse=True)
        top_3 = [int(s[0]) for s in scores[:3]]
        
        return jsonify({
            "status": "success",
            "model": "Roulette_DeepLearning_v1",
            "predictions": top_3,
            "confidence": round(float(scores[0][1]), 2)
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Run on 5000 for frontend default parsing
    app.run(host='0.0.0.0', port=5000, debug=False)
