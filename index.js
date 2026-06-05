const express = require('express');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

app.post('/transfer', async (req, res) => {
  const message = req.body.message;
  const callSid = message.call.transport.callSid;
  const destination = message.toolCallList[0].function.arguments.destination;

  console.log('CallSid: ' + callSid + ', Destination: ' + destination);

  res.json({ result: 'Transferring now' });

  try {
    const recordingCallback = 'https://activate-call-recording-twilio.onrender.com/recording-complete';
    const childCallback = 'https://activate-call-recording-twilio.onrender.com/child-status';
    const twiml = '<Response><Dial action="https://activate-call-recording-twilio.onrender.com/transfer-complete" record="record-from-answer-dual" recordingStatusCallback="' + recordingCallback + '" recordingStatusCallbackMethod="POST"><Number statusCallback="' + childCallback + '" statusCallbackEvent="initiated ringing in-progress completed" statusCallbackMethod="POST">' + destination + '</Number></Dial></Response>';

    await client.calls(callSid).update({ twiml: twiml });
    console.log('Transfer executed for ' + callSid);
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
