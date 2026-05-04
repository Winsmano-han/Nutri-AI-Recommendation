#!/bin/bash

# Start script for Render deployment
# Starts both Python model server and Node.js API server

echo "🚀 Starting Nutrifence services..."

# Set Python path for model imports
export PYTHONPATH="${PYTHONPATH}:./best_models_bundle"

# Set model paths
export DISH_MODEL_PATH="./best_models_bundle/models/recommender_nigeria_dishes_extended.joblib"
export FOOD_MODEL_PATH="./best_models_bundle/models/recommender_nigeria.joblib"

# Start Python model server in background
echo "Starting Python model server on port 8011..."
cd scraper
python -m uvicorn model_server:app --host 0.0.0.0 --port 8011 &
PYTHON_PID=$!

# Wait for model server to be ready
echo "Waiting for model server to start..."
sleep 10

# Start Node.js API server
echo "Starting Node.js API server on port ${PORT:-8090}..."
export API_HOST="0.0.0.0"
export API_PORT="${PORT:-8090}"
export MODEL_API_URL="http://127.0.0.1:8011"

node api_server.js &
NODE_PID=$!

echo "✅ Both services started"
echo "   Python model server PID: $PYTHON_PID"
echo "   Node.js API server PID: $NODE_PID"

# Wait for both processes
wait -n

# If one exits, kill the other
kill $PYTHON_PID $NODE_PID 2>/dev/null
exit $?
