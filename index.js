const express = require('express');
const twilio = require('twilio');
const https = require('https');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

app.post('/transfer', async (req, res) => {
  const message = req.body.message;
  const callSid = message.call.transport.callSid;
  const controlUrl = message.call.monitor.controlUrl;
  const destination = message.toolCallList[0].function.arguments.destination;
  const toolCallId = message.toolCallList[0].id;

  console.log('CallSid: ' + callSid + ', Destination: ' + destination);
  console.log('ControlUrl: ' + controlUrl);

  res.json({
    results: [{ toolCallId: toolCallId, result: 'Transferring now' }]
  });

  try {
    const body = JSON.stringify({
      type: 'transfer',
      destination: { type: 'number', number: destination },
      content: 'Dame un momento, te comunico con un asesor.'
    });

    const url = new URL(controlUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const request = https.request(options, (response) => {
      console.log('Control response: ' + response.statusCode);
    });
    request.on('error', (e) => console.error('Control error: ' + e.message));
    request.write(body);
    request.end();

    console.log('Transfer command sent for ' + callSid);
  } catch (err) {
    console.error('Error: ' + err.message);
  }
});

app.post('/transfer-complete', (req, res) => {
  console.log('Transfer complete: ' + JSON.stringify(req.body));
  res.type('text/xml');
  res.send('<Response><Hangup/></Response>');
});

app.post('/recording-complete', (req, res) => {
  const sid = req.body.RecordingSid;
  const url = req.body.RecordingUrl;
  const duration = req.body.RecordingDuration;
  console.log('Recording ready - SID: ' + sid + ', Duration: ' + duration + 's, URL: ' + url);
  res.sendStatus(200);
});

app.post('/child-status', (req, res) => {
  console.log('Child: ' + req.body.CallSid + ' = ' + req.body.CallStatus);
  res.sendStatus(200);
});

app.get('/', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
