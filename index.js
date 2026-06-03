const express = require('express');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

app.post('/child-call-status', async (req, res) => {
  const { CallSid, CallStatus } = req.body;

  console.log(`Child call ${CallSid} status: ${CallStatus}`);

  if (CallStatus === 'in-progress') {
    try {
      await client.calls(CallSid).recordings.create({
        recordingChannels: 'dual'
      });
      console.log(`Recording started for ${CallSid}`);
    } catch (err) {
      console.error('Error starting recording:', err.message);
    }
  }

  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
