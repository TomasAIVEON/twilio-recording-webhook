const express = require('express');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

app.post('/transfer', async (req, res) => {
  const { callSid, destination } = req.body;
  console.log('Transfer request - CallSid: ' + callSid + ', Destination: ' + destination);

  try {
    const recordingCallback = 'https://activate-call-recording-twilio.onrender.com/recording-complete';
    const childCallback = 'https://activate-call-recording-twilio.onrender.com/child-status';

    const twiml = '<Response><Dial action="/transfer-complete" record="record-from-answer-dual" recordingStatusCallback="' + recordingCallback + '" recordingStatusCallbackMethod="POST"><Number statusCallback="' + childCallback + '" statusCallbackEvent="initiated ringing in-progress completed" statusCallbackMethod="POST">' + destination + '</Number></Dial></Response>';

    await client.calls(callSid).update({ twiml: twiml });

    res.json({ result: 'Transfer initiated with recording' });
  } catch (err) {
    console.error('Error: ' + err.message);
    res.json({ result: 'Error: ' + err.message });
  }
});

app.post('/recording-complete', (req, res) => {
  const RecordingSid = req.body.RecordingSid;
  const RecordingUrl = req.body.RecordingUrl;
  const RecordingDuration = req.body.RecordingDuration;
  console.log('Recording ready - SID: ' + RecordingSid + ', Duration: ' + RecordingDuration + 's, URL: ' + RecordingUrl);
  res.sendStatus(200);
});

app.post('/child-status', (req, res) => {
  const CallSid = req.body.CallSid;
  const CallStatus = req.body.CallStatus;
  console.log('Child call ' + CallSid + ': ' + CallStatus);
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
