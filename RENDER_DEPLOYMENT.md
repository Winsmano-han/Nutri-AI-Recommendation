# Deploying Nutrifence to Render

This guide walks you through deploying the Nutrifence API to Render.

## Prerequisites

1. **GitHub account** - Your code must be in a GitHub repository
2. **Render account** - Sign up at https://render.com (free tier available)
3. **API Keys**:
   - Google Maps API key
   - Groq API key

## Files Created for Deployment

- `render.yaml` - Render service configuration
- `start.sh` - Startup script that runs both Python and Node.js servers
- `RENDER_DEPLOYMENT.md` - This guide

## Deployment Steps

### Step 1: Push Code to GitHub

```bash
# Initialize git if not already done
git init

# Add all files
git add .

# Commit
git commit -m "Prepare for Render deployment"

# Create GitHub repo and push
git remote add origin https://github.com/YOUR_USERNAME/nutri-recommendation.git
git branch -M main
git push -u origin main
```

### Step 2: Create Render Service

1. Go to https://dashboard.render.com
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Select the `nutri-recommendation` repository

### Step 3: Configure Service

**Basic Settings:**
- **Name**: `nutrifence-api` (or your preferred name)
- **Region**: Choose closest to your users (e.g., Oregon, Frankfurt)
- **Branch**: `main`
- **Root Directory**: Leave empty
- **Environment**: `Python`
- **Build Command**: 
  ```bash
  pip install -r requirements.txt && chmod +x start.sh
  ```
- **Start Command**: 
  ```bash
  ./start.sh
  ```

**Instance Type:**
- Free tier is fine for testing
- Upgrade to Starter ($7/month) for production

### Step 4: Add Environment Variables

In the Render dashboard, add these environment variables:

**Required:**
```
GOOGLE_MAPS_API_KEY=your_google_maps_key_here
GROQ_API_KEY=your_groq_key_here
```

**Auto-configured (already in render.yaml):**
```
PYTHON_VERSION=3.10.0
NODE_VERSION=18.0.0
MODEL_API_URL=http://127.0.0.1:8011
API_HOST=0.0.0.0
PYTHONPATH=./best_models_bundle
DISH_MODEL_PATH=./best_models_bundle/models/recommender_nigeria_dishes_extended.joblib
FOOD_MODEL_PATH=./best_models_bundle/models/recommender_nigeria.joblib
```

### Step 5: Deploy

1. Click **"Create Web Service"**
2. Render will automatically:
   - Clone your repository
   - Install Python dependencies
   - Install Node.js (via buildpack detection)
   - Run the start script
   - Start both servers

### Step 6: Verify Deployment

Once deployed, your service URL will be: `https://nutrifence-api.onrender.com`

Test the health endpoint:
```bash
curl https://nutrifence-api.onrender.com/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "nutrifence-api",
  "port": 8090
}
```

## API Endpoints

Your deployed API will have these endpoints:

### 1. Health Check
```bash
GET https://nutrifence-api.onrender.com/health
```

### 2. Get Recommendations
```bash
POST https://nutrifence-api.onrender.com/api/recommendations
Content-Type: application/json

{
  "lat": 7.3622,
  "lng": 3.8503,
  "radius": 1500,
  "maxRestaurants": 5,
  "userProfile": {
    "conditions": ["diabetes"],
    "restrictions": ["low sugar"]
  }
}
```

### 3. Ingest Nutritionist Report
```bash
POST https://nutrifence-api.onrender.com/api/ingest-report
Content-Type: application/json

{
  "userId": "user_001",
  "reportText": "Patient should avoid high sugar foods..."
}
```

## Troubleshooting

### Build Fails

**Issue**: Python dependencies fail to install
**Solution**: Check that `requirements.txt` is in the root directory

**Issue**: Node.js not detected
**Solution**: Ensure `package.json` is in the root directory

### Service Crashes

**Issue**: Model files not found
**Solution**: Verify model files are committed to Git:
```bash
git add best_models_bundle/models/*.joblib
git commit -m "Add model files"
git push
```

**Issue**: Out of memory
**Solution**: Upgrade to a paid plan with more RAM (model files are large)

### API Returns Errors

**Issue**: Google Maps API errors
**Solution**: Check that `GOOGLE_MAPS_API_KEY` is set correctly in Render dashboard

**Issue**: Groq API errors
**Solution**: Check that `GROQ_API_KEY` is set correctly

## Important Notes

### Free Tier Limitations

- **Spins down after 15 minutes of inactivity**
- First request after spin-down takes 30-60 seconds (cold start)
- 750 hours/month free (enough for one service)

### Model Files

- Your `.joblib` model files must be in Git
- If files are too large (>100MB), consider:
  - Using Git LFS (Large File Storage)
  - Downloading models at build time from cloud storage
  - Using a smaller model

### Environment Variables

- Never commit `.env` file to Git
- Always set sensitive keys in Render dashboard
- Use the "Secret File" feature for large config files

## Monitoring

### View Logs

1. Go to Render dashboard
2. Select your service
3. Click "Logs" tab
4. You'll see both Python and Node.js logs

### Check Metrics

1. Go to "Metrics" tab
2. Monitor:
   - CPU usage
   - Memory usage
   - Request count
   - Response times

## Updating Your Deployment

```bash
# Make changes to your code
git add .
git commit -m "Update API"
git push

# Render automatically redeploys on push to main branch
```

## Custom Domain (Optional)

1. Go to service settings
2. Click "Custom Domain"
3. Add your domain (e.g., `api.nutrifence.com`)
4. Update DNS records as instructed

## Scaling

### Horizontal Scaling
- Free tier: 1 instance only
- Paid plans: Add multiple instances for load balancing

### Vertical Scaling
- Upgrade instance type for more CPU/RAM
- Recommended for model serving: Starter ($7/mo) or Standard ($25/mo)

## Alternative: Deploy as Two Separate Services

If you encounter issues running both servers in one service:

### Service 1: Python Model Server
```yaml
services:
  - type: web
    name: nutrifence-model-server
    env: python
    buildCommand: pip install -r requirements.txt
    startCommand: cd scraper && python -m uvicorn model_server:app --host 0.0.0.0 --port $PORT
```

### Service 2: Node.js API Server
```yaml
services:
  - type: web
    name: nutrifence-api
    env: node
    buildCommand: npm install
    startCommand: node scraper/api_server.js
    envVars:
      - key: MODEL_API_URL
        value: https://nutrifence-model-server.onrender.com
```

## Support

- Render Docs: https://render.com/docs
- Render Community: https://community.render.com
- Your project README: `README.md`

## Cost Estimate

**Free Tier:**
- 1 web service
- 750 hours/month
- Spins down after inactivity
- **Cost: $0/month**

**Production Setup:**
- Starter plan: $7/month
- Always on
- 512MB RAM
- **Cost: $7/month**

**Recommended for Production:**
- Standard plan: $25/month
- 2GB RAM (better for ML models)
- **Cost: $25/month**
