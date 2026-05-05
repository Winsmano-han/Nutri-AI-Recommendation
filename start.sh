#!/bin/bash

# Start script for Render deployment
# Starts both Python model server and Node.js API server

echo "🚀 Starting Nutrifence services..."

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
  else
    echo "❌ Python executable not found. Set PYTHON_BIN to your Python command."
    exit 1
  fi
fi

# Set Python path for model imports
export PYTHONPATH="${PYTHONPATH}:${ROOT_DIR}/best_models_bundle"

# Set model paths
export DISH_MODEL_PATH="${ROOT_DIR}/best_models_bundle/models/recommender_nigeria_dishes_extended.joblib"
export FOOD_MODEL_PATH="${ROOT_DIR}/best_models_bundle/models/recommender_nigeria.joblib"

echo "Dish model path: ${DISH_MODEL_PATH}"
echo "Food model path: ${FOOD_MODEL_PATH}"

# Start Python model server in background
echo "Starting Python model server on port 8011..."
cd "${ROOT_DIR}/scraper"
"$PYTHON_BIN" -m uvicorn model_server:app --host 0.0.0.0 --port 8011 &
PYTHON_PID=$!

# Wait for model server to be ready
echo "Waiting for model server to start..."
for i in {1..60}; do
  if curl -fsS http://127.0.0.1:8011/health >/dev/null 2>&1; then
    echo "✅ Python model server is healthy"
    break
  fi

  if ! kill -0 "$PYTHON_PID" 2>/dev/null; then
    echo "❌ Python model server exited before becoming healthy"
    exit 1
  fi

  if [ "$i" -eq 60 ]; then
    echo "❌ Python model server did not become healthy in time"
    kill "$PYTHON_PID" 2>/dev/null
    exit 1
  fi

  sleep 1
done

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
