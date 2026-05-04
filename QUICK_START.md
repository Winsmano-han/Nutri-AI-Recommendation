# 🚀 Quick Start: Deploy to Render

## Step 1: Prepare Your Code

```bash
# Make sure you're in the project directory
cd c:\Users\DELL\Desktop\Nutri-Recommendation

# Check that model files exist
dir best_models_bundle\models\*.joblib

# You should see:
# - recommender_nigeria.joblib
# - recommender_nigeria_dishes_extended.joblib
```

## Step 2: Push to GitHub

```bash
# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Add Render deployment configuration"

# Create a new repository on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/nutri-recommendation.git
git branch -M main
git push -u origin main
```

## Step 3: Deploy on Render

1. **Go to Render Dashboard**
   - Visit: https://dashboard.render.com
   - Sign up or log in

2. **Create New Web Service**
   - Click "New +" → "Web Service"
   - Connect your GitHub account
   - Select your `nutri-recommendation` repository

3. **Configure Service**
   ```
   Name: nutrifence-api
   Region: Oregon (or closest to your users)
   Branch: main
   Root Directory: (leave empty)
   Environment: Python
   
   Build Command:
   pip install -r requirements.txt && chmod +x start.sh
   
   Start Command:
   ./start.sh
   
   Instance Type: Free (or Starter for production)
   ```

4. **Add Environment Variables**
   - Click "Environment" tab
   - Add these variables:
   ```
   GOOGLE_MAPS_API_KEY = your_google_maps_key_here
   GROQ_API_KEY = your_groq_key_here
   ```

5. **Deploy**
   - Click "Create Web Service"
   - Wait 5-10 minutes for deployment
   - Watch the logs for any errors

## Step 4: Test Your Deployment

Once deployed, your URL will be: `https://nutrifence-api.onrender.com`

### Test locally first (optional):
```bash
# Test health endpoint
node health_check.js

# Run full test suite
node test_deployment.js http://127.0.0.1:8090
```

### Test production:
```bash
# Test health endpoint
curl https://nutrifence-api.onrender.com/health

# Run full test suite
node test_deployment.js https://nutrifence-api.onrender.com
```

### Test recommendations:
```bash
curl -X POST https://nutrifence-api.onrender.com/api/recommendations \
  -H "Content-Type: application/json" \
  -d "{\"lat\":7.3775,\"lng\":3.9470,\"radius\":2000,\"maxRestaurants\":5,\"userProfile\":{\"conditions\":[],\"restrictions\":[]}}"
```

## Step 5: Update Your Mobile App

In your Flutter app, update the API base URL:

```dart
// Before (local development)
const String API_BASE_URL = "http://127.0.0.1:8090";

// After (production)
const String API_BASE_URL = "https://nutrifence-api.onrender.com";
```

## Troubleshooting

### Build Fails
```bash
# Check that requirements.txt is in root
dir requirements.txt

# Check that start.sh exists
dir start.sh

# Check that model files are committed
git ls-files best_models_bundle/models/
```

### Service Crashes
- Check logs in Render dashboard
- Look for "Out of memory" errors
- Consider upgrading to paid plan (more RAM)

### API Returns Errors
- Verify environment variables are set correctly
- Check API keys are valid
- Look at logs for specific error messages

### Cold Start Issues (Free Tier)
- First request after 15 min takes 30-60 seconds
- This is normal for free tier
- Upgrade to Starter ($7/mo) for always-on service

## Important Files Created

- ✅ `render.yaml` - Render configuration
- ✅ `start.sh` - Startup script for both servers
- ✅ `health_check.js` - Health verification script
- ✅ `test_deployment.js` - Full API test suite
- ✅ `RENDER_DEPLOYMENT.md` - Complete deployment guide
- ✅ `DEPLOYMENT_CHECKLIST.md` - Quick checklist
- ✅ `DEPLOYMENT_SUMMARY.md` - Architecture overview

## Next Steps

1. ✅ Deploy to Render
2. ✅ Test all endpoints
3. ✅ Update mobile app with production URL
4. ✅ Monitor logs and performance
5. ✅ Consider upgrading to paid plan for production
6. ✅ Set up custom domain (optional)

## Cost

- **Free Tier**: $0/month (spins down after 15 min)
- **Starter**: $7/month (always on, 512MB RAM)
- **Standard**: $25/month (2GB RAM, better for ML models)

## Support

- **Quick Start**: This file
- **Full Guide**: `RENDER_DEPLOYMENT.md`
- **Checklist**: `DEPLOYMENT_CHECKLIST.md`
- **Architecture**: `DEPLOYMENT_SUMMARY.md`
- **Render Docs**: https://render.com/docs

## Your API Endpoints

Once deployed:

```
GET  https://nutrifence-api.onrender.com/health
POST https://nutrifence-api.onrender.com/api/recommendations
POST https://nutrifence-api.onrender.com/api/ingest-report
```

## Questions?

Check the detailed guides:
- `RENDER_DEPLOYMENT.md` - Complete deployment guide
- `DEPLOYMENT_CHECKLIST.md` - Step-by-step checklist
- `DEPLOYMENT_SUMMARY.md` - Architecture and how it works

Good luck! 🚀
