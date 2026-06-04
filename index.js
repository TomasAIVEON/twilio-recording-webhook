const express = require('express');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.post('/transfer', (req, res) => {
  console.log('BODY COMPLETO: ' + JSON.stringify(req.body));
  res.json({ result: 'ok' });
});

app.get('/', (req, res) => {
  res.send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
