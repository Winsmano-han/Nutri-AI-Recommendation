# Render Deployment - Files Summary

## Files Created for Deployment

### 1. `render.yaml`
**Purpose**: Render service configuration  
**What it does**: Tells Render how to build and run your service

### 2. `start.sh`
**Purpose**: Startup script  
**What it does**: 
- Starts Python model server on port 8011
- Starts Node.js API server on port 8090 (or $PORT from Render)
- Keeps both running simultaneously

### 3. `RENDER_DEPLOYMENT.md`
**Purpose**: Complete deployment guide  
**What it includes**:
- Step-by-step deployment instructions
- Configuration details
- Troubleshooting tips
- API endpoint documentation
- Scaling and monitoring guidance

### 4. `DEPLOYMENT_CHECKLIST.md`
**Purpose**: Quick reference checklist  
**What it includes**:
- Pre-deployment checklist
- Quick deployment steps
- Test commands
- Common issues and fixes

### 5. `health_check.js`
**Purpose**: Health verification script  
**What it does**: Tests if both servers are running properly

## Modified Files

### `package.json`
- Updated start command to run API server
- Added dependencies field

## How the Deployment Works

```
Render receives your code
         ↓
Installs Python dependencies (requirements.txt)
         ↓
Makes start.sh executable
         ↓
Runs start.sh
         ↓
    ┌────────────────────┐
    │   start.sh runs:   │
    └────────────────────┘
         ↓
    ┌────────────────────────────────┐
    │  Python model server (port 8011) │ ← Background
    └────────────────────────────────┘
         ↓
    ┌────────────────────────────────┐
    │  Node.js API server (port 8090)  │ ← Foreground
    └────────────────────────────────┘
         ↓
    Your API is live! 🎉
```

## Architecture

```
User Request
    ↓
Render Load Balancer
    ↓
Node.js API Server (port 8090)
    ↓
Python Model Server (port 8011)
    ↓
ML Models (.joblib files)
```

## Environment Variables Required

Set these in Render dashboard:

```bash
GOOGLE_MAPS_API_KEY=your_google_key
GROQ_API_KEY=your_groq_key
```

Auto-configured (already in render.yaml):
```bash
PYTHON_VERSION=3.10.0
NODE_VERSION=18.0.0
MODEL_API_URL=http://127.0.0.1:8011
API_HOST=0.0.0.0
PYTHONPATH=./best_models_bundle
DISH_MODEL_PATH=./best_models_bundle/models/recommender_nigeria_dishes_extended.joblib
FOOD_MODEL_PATH=./best_models_bundle/models/recommender_nigeria.joblib
```

## Quick Start

1. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Add Render deployment files"
   git push origin main
   ```

2. **Create Render service**:
   - Go to https://dashboard.render.com
   - New + → Web Service
   - Connect your GitHub repo

3. **Configure**:
   - Build: `pip install -r requirements.txt && chmod +x start.sh`
   - Start: `./start.sh`
   - Add environment variables

4. **Deploy**: Click "Create Web Service"

5. **Test**:
   ```bash
   curl https://your-service.onrender.com/health
   ```

## API Endpoints

Once deployed:

```bash
# Health check
GET https://your-service.onrender.com/health

# Get recommendations
POST https://your-service.onrender.com/api/recommendations
{
  "lat": 7.3775,
  "lng": 3.9470,
  "radius": 2000,
  "userProfile": {
    "conditions": ["diabetes"],
    "restrictions": []
  }
}

# Ingest nutritionist report
POST https://your-service.onrender.com/api/ingest-report
{
  "userId": "user_001",
  "reportText": "..."
}
```

## Cost

- **Free tier**: $0/month (spins down after 15 min inactivity)
- **Starter**: $7/month (always on, 512MB RAM)
- **Standard**: $25/month (2GB RAM, better for ML models)

## Important Notes

1. **Model files must be in Git** - They're needed for deployment
2. **Free tier has cold starts** - First request after inactivity takes 30-60s
3. **Both servers run in one container** - More cost-effective
4. **Logs show both Python and Node output** - Easy debugging

## Next Steps After Deployment

1. ✅ Test all endpoints
2. ✅ Update mobile app with production URL
3. ✅ Monitor logs and performance
4. ✅ Consider upgrading to paid plan
5. ✅ Set up custom domain (optional)

## Support

- **Full guide**: See `RENDER_DEPLOYMENT.md`
- **Quick checklist**: See `DEPLOYMENT_CHECKLIST.md`
- **Render docs**: https://render.com/docs
- **Project README**: See `README.md`
