# Render Deployment Checklist

## Before You Deploy

- [ ] Code is in a GitHub repository
- [ ] Model files (`.joblib`) are committed to Git
- [ ] `.env` file is NOT committed (it's in .gitignore)
- [ ] You have a Render account (https://render.com)
- [ ] You have your API keys ready:
  - [ ] Google Maps API key
  - [ ] Groq API key

## Deployment Steps

### 1. Push to GitHub
```bash
git add .
git commit -m "Ready for Render deployment"
git push origin main
```

### 2. Create Render Service
1. Go to https://dashboard.render.com
2. Click "New +" → "Web Service"
3. Connect GitHub repository
4. Select your repo

### 3. Configure Service
- **Name**: `nutrifence-api`
- **Environment**: `Python`
- **Build Command**: 
  ```
  pip install -r requirements.txt && chmod +x start.sh
  ```
- **Start Command**: 
  ```
  ./start.sh
  ```

### 4. Add Environment Variables
Click "Environment" tab and add:
```
GOOGLE_MAPS_API_KEY=your_key_here
GROQ_API_KEY=your_key_here
```

### 5. Deploy
Click "Create Web Service" and wait 5-10 minutes

### 6. Test
```bash
curl https://your-service.onrender.com/health
```

## Quick Test Commands

### Health Check
```bash
curl https://your-service.onrender.com/health
```

### Get Recommendations (Ibadan, Oluyole)
```bash
curl -X POST https://your-service.onrender.com/api/recommendations \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 7.3775,
    "lng": 3.9470,
    "radius": 2000,
    "maxRestaurants": 5,
    "userProfile": {
      "conditions": [],
      "restrictions": []
    }
  }'
```

### Get Recommendations (Lagos, Victoria Island)
```bash
curl -X POST https://your-service.onrender.com/api/recommendations \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 6.4281,
    "lng": 3.4219,
    "radius": 3000,
    "maxRestaurants": 5,
    "userProfile": {
      "conditions": ["diabetes"],
      "restrictions": ["low sugar"]
    }
  }'
```

## Troubleshooting

### Build fails
- Check logs in Render dashboard
- Verify `requirements.txt` is in root directory
- Ensure model files are committed

### Service crashes
- Check if model files are too large (>100MB each)
- Consider upgrading to paid plan for more RAM
- Check logs for Python/Node errors

### API returns errors
- Verify environment variables are set
- Check API keys are valid
- Look at logs for specific error messages

## Important Notes

- **Free tier spins down after 15 minutes** - First request will be slow
- **Cold start takes 30-60 seconds** - This is normal
- **Upgrade to Starter ($7/mo)** for always-on service
- **Model files must be in Git** - Don't add `*.joblib` to .gitignore

## Your Service URL

After deployment, your API will be at:
```
https://nutrifence-api.onrender.com
```

Replace `nutrifence-api` with whatever name you chose.

## Next Steps

1. Test all endpoints
2. Update your mobile app to use the Render URL
3. Monitor logs and metrics
4. Consider upgrading to paid plan for production
5. Set up custom domain (optional)

## Support

- Full guide: `RENDER_DEPLOYMENT.md`
- Render docs: https://render.com/docs
- Project README: `README.md`
