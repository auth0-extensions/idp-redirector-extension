# IdP Redirector Extension

## Run locally

```bash
npm install
```

Update `./server/config.json` with config values.

```bash
npm run serve:dev
```

## Publish

```bash
npm run extension:build
git add .
git commit -m 'build x'
git push origin master
```

## Deploying to Auth0

Navigate to the Extensions section of the Auth0 Management Dashboard

Click “Create Extension” as shown in the below screenshot

![](images/create-extension.png)

Enter the URL of the github repo where the IdP Redirector Extension is located and click Continue to install. 

![](images/new-extension.png)