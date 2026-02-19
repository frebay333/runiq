import urllib.request
import json

CLIENT_ID     = 'PASTE_YOUR_CLIENT_ID'
CLIENT_SECRET = 'PASTE_YOUR_CLIENT_SECRET'
CODE          = 'PASTE_YOUR_CODE'

data = json.dumps({
    'client_id':     CLIENT_ID,
    'client_secret': CLIENT_SECRET,
    'code':          CODE,
    'grant_type':    'authorization_code'
}).encode()

req = urllib.request.Request(
    'https://www.strava.com/oauth/token',
    data=data,
    headers={'Content-Type': 'application/json'},
    method='POST'
)

try:
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
        print('\n✓ SUCCESS! Your access token:')
        print(result['access_token'])
        print('\nPaste that into index.html')
except urllib.error.HTTPError as e:
    print('Error:', e.code, json.loads(e.read()))
