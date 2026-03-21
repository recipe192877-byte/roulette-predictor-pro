import json
from app import app

client = app.test_client()

# Sample roulette sequence to test the ML math (mix of different numbers to verify delay/sector bonus)
spins = [32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26, 0, 32, 15, 19, 4, 32, 15]

def run_test():
    response = client.post('/predict', json={'spins': spins})
    print("Status Code:", response.status_code)
    try:
        print("Response JSON:", json.dumps(response.get_json(), indent=2))
        data = response.get_json()
        assert data['status'] == 'success'
        assert len(data['predictions']) == 3
        print("TEST PASSED")
    except Exception as e:
        print("TEST FAILED", e)
        print(response.get_data(as_text=True))

if __name__ == '__main__':
    run_test()
