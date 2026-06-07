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

// ================================================
// AGREGAR NUEVAS EMPRESAS AQUI
const CLIENT_CONFIG = {
  indomo: 'https://hook.us2.make.com/n27oscm6jtz4ozn8p3nrfjpmbwnnkgtp',
  // empresa2: 'https://hook.us2.make.com/XXXX',
};
// ================================================

const activeCalls = {};

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

async function transcribeRecording(recordingSid, recordingUrl, parentCallSid, childCallSid, customerNumber, empresa) {
  console.log('Downloading audio: ' + recordingSid);
  const audioBuffer = await downloadAudio(recordingUrl);
  console.log('Audio downloaded, size: ' + audioBuffer.length + ' bytes');

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.deepgram.com',
      path: '/v1/listen?language=es&punctuate=true&diarize=true&model=nova-3',
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
          let transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || 'No transcript';

          const voicemailPhrases = ['buzón', 'buzon', 'no está disponible', 'deja tu mensaje', 'después del tono', 'despues del tono', 'graba tu mensaje', 'puedes colgar', 'no available', 'leave a message'];
          const isVoicemail = voicemailPhrases.some(phrase => transcript.toLowerCase().includes(phrase));

          if (isVoicemail) {
            console.log('Voicemail detected, marking as no-answer');
            transcript = 'no-answer';
          }

          console.log('TRANSCRIPT: ' + transcript);
          sendToMake(parentCallSid, childCallSid, recordingSid, transcript, customerNumber, empresa);
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

function sendToMake(parentCallSid, childCallSid, recordingSid, transcript, customerNumber, empresa) {
  const webhookUrl = CLIENT_CONFIG[empresa.toLowerCase()];

  if (!webhookUrl) {
    console.error('No webhook found for empresa: ' + empresa);
    return;
  }

  console.log('Sending to webhook for empresa: ' + empresa);

  const body = JSON.stringify({
    parentCallSid: parentCallSid,
    childCallSid: childCallSid,
    customerNumber: customerNumber,
    recordingSid: recordingSid,
    transcript: transcript,
    empresa: empresa
  });

  const url = new URL(webhookUrl);
  const options = {
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const req = https.request(options, (res) => {
    console.log('Make webhook response: ' + res.statusCode);
  });
  req.on('error', (e) => console.error('Make error: ' + e.message));
  req.write(body);
  req.end();
}

async function waitAndRecord(parentCallSid, customerNumber, empresa) {
  await new Promise(r => setTimeout(r, 4000));

  for (let i = 0; i < 10; i++) {
    try {
      const calls = await client.calls.list({ parentCallSid: parentCallSid, limit: 5 });

      const active = calls.find(c => c.status === 'in-progress');
      if (active) {
        console.log('Child found: ' + active.sid + ' status: ' + active.status);
        activeCalls[active.sid] = { parentCallSid, customerNumber, empresa };
        await client.calls(active.sid).recordings.create({
          recordingChannels: 'dual',
          recordingStatusCallback: 'https://activate-call-recording-twilio.onrender.com/recording-complete',
          recordingStatusCallbackMethod: 'POST'
        });
        console.log('Recording started for ' + active.sid);
        return;
      }

      const anyChild = calls[0];
      if (anyChild) {
        console.log('Child found with status: ' + anyChild.status + ' SID: ' + anyChild.sid);
        if (anyChild.status === 'no-answer' || anyChild.status === 'busy' || anyChild.status === 'failed') {
          sendToMake(parentCallSid, anyChild.sid, 'no-recording', 'no-answer', customerNumber, empresa);
          return;
        }
        if (anyChild.status === 'completed') {
          console.log('Child already completed, checking recordings...');
          activeCalls[anyChild.sid] = { parentCallSid, customerNumber, empresa };
          return;
        }
      }

      console.log('Attempt ' + (i+1) + ': no active child yet, calls found: ' + calls.length);

    } catch (err) {
      console.error('Polling error: ' + err.message);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  const calls = await client.calls.list({ parentCallSid: parentCallSid, limit: 5 }).catch(() => []);
  const anyChild = calls[0];
  if (anyChild) {
    sendToMake(parentCallSid, anyChild.sid, 'no-recording', 'no-answer', customerNumber, empresa);
  } else {
    sendToMake(parentCallSid, 'unknown', 'no-recording', 'no-answer', customerNumber, empresa);
  }
}

app.post('/transfer', async (req, res) => {
  const message = req.body.message;
  const parentCallSid = message.call.transport.callSid;
  const controlUrl = message.call.monitor.controlUrl;
  const destination = message.toolCallList[0].function.arguments.destination;
  const toolCallId = message.toolCallList[0].id;
  const customerNumber = message.call.customer.number;
  const empresa = message.toolCallList[0].function.arguments.empresa || 'indomo';

  console.log('ParentCallSid: ' + parentCallSid + ', Destination: ' + destination + ', Customer: ' + customerNumber + ', Empresa: ' + empresa);

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

    waitAndRecord(parentCallSid, customerNumber, empresa);

  } catch (err) {
    console.error('Error: ' + err.message);
  }
});

app.post('/recording-complete', async (req, res) => {
  const sid = req.body.RecordingSid;
  const url = req.body.RecordingUrl;
  const duration = req.body.RecordingDuration;
  const childCallSid = req.body.CallSid;
  const callInfo = activeCalls[childCallSid] || {};
  const parentCallSid = callInfo.parentCallSid || 'unknown';
  const customerNumber = callInfo.customerNumber || 'unknown';
  const empresa = callInfo.empresa || 'indomo';

  console.log('Recording ready - SID: ' + sid + ', Duration: ' + duration + 's, Parent: ' + parentCallSid + ', Child: ' + childCallSid + ', Empresa: ' + empresa);
  res.sendStatus(200);

  try {
    await transcribeRecording(sid, url, parentCallSid, childCallSid, customerNumber, empresa);
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
