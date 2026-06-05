const express = require('express');
const twilio = require('twilio');
const https = require('https');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const deepgramKey = process.env.DEEPGRAM_API_KEY;
const client = twilio(accountSid, authToken);

async function downloadAudio(recordingUrl) {
  const url = new URL(recordingUrl + '.wav');
  const auth = Buffer.from(accountSid + ':' + authToken).toString('base64');

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: { 'Authorization': 'Basic ' + auth }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        const redirectUrl = new URL(res.headers.location);
        const redirectOptions = {
          hostname: redirectUrl.hostname,
          path: redirectUrl.pathname + (redirectUrl.search || ''),
          method: 'GET'
        };
        const req2 = https.request(redirectOptions, (res2) => {
          const chunks = [];
          res2.on('data', chunk => chunks.push(chunk));
          res2.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req2.on('error', reject);
        req2.end();
      } else {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    });
    req.on('error', reject);
    req.end();
  });
}

async function transcribeRecording(recordingSid, recordingUrl) {
  console.log('Downloading audio: ' + recordingSid);
  const audioBuffer = await downloadAudio(recordingUrl);
  console.log('Audio downloaded, size: ' + audioBuffer.length + ' bytes');

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.deepgram.com',
      path: '/v1/listen?language=es&punctuate=true&diarize=true',
      method: 'POST',
      headers: {
        'Authorization': 'Token ' + deepgramKey,
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || 'No transcript';
          console.log('TRANSCRIPT: ' + transcript);
          resolve(transcript);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(audioBuffer);
    req.end();
  });
}

async function waitAndRecord(parentCallSid) {
  await new Promise(r => setTimeout(r, 4000));

  for (let i = 0; i < 10; i++) {
    try {
      const calls = await client.calls.list({ parentCallSid: parentCallSid, limit: 5 });
      const active = calls.find(c => c.status === 'in-progress');

      if (active) {
        console.log('Child found: ' + active.sid + ' status: ' + active.status);
        await client.calls(active.sid).recordings.create({
          recordingChannels: 'dual',
          recordingStatusCallback: 'https://activate-call-recording-twilio.onrender.com/recording-complete',
          recordingStatusCallbackMethod: 'POST'
        });
        console.log('Recording started for ' + active.sid);
        return;
      } else {
        console.log('Attempt ' + (i+1) + ': no active child yet, calls found: ' + calls.length);
      }
    } catch (err) {
      console.error('Polling error: ' + err.message);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log('Could not find active child call after 10 attempts');
}

app.post('/transfer', async (req, res) => {
  const message = req.body.message;
  const callSid = message.call.transport.callSid;
  const controlUrl = message.call.monitor.controlUrl;
  const destination = message.toolCallList[0].function.arguments.destination;
  const toolCallId = message.toolCallList[0].id;

  console.log('CallSid: ' + callSid + ', Destination: ' + destination);

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

    waitAndRecord(callSid);

  } catch (err) {
    console.error('Error: ' + err.message);
  }
});

app.post('/recording-complete', async (req, res) => {
  const sid = req.body.RecordingSid;
  const url = req.body.RecordingUrl;
  const duration = req.body.RecordingDuration;
  console.log('Recording ready - SID: ' + sid + ', Duration: ' + duration + 's');
  res.sendStatus(200);

  try {
    await transcribeRecording(sid, url);
  } catch (err) {
    console.error('Transcription error: ' + err.message);
  }
});

app.post('/child-status', (req, res) => {
  console.log('Child: ' + req.body.CallSid + ' = ' + req.body.CallStatus);
  res.sendStatus(200);
});

app.get('/', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
