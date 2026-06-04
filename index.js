const express = require('express');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

// Custom tool endpoint - VAPI llama aqui antes de transferir
app.post('/transfer', async (req, res) => {
  const { callSid, destination } = req.body;

  console.log(`Transfer request - CallSid: ${callSid}, Destination: ${destination}`);

  try {
    // Iniciar el transfer via Twilio con statusCallback al child call
    await client.calls(callSid).update({
      twiml: `<Response>
        <Dial callerId="${req.body.callerId || ''}" 
              action="/transfer-complete"
              record="record-from-answer-dual"
              recordingStatusCallback="https://activate-call-recording-twilio.onrender.com/recording-complete"
              recordingStatusCallbackMethod="POST">
          <Number statusCallback="https://activate-call-recording-twilio.onrender.com/child-status"
                  statusCallb
