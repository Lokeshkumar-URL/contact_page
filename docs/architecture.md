# Architecture

The React dashboard calls the Express API. The backend owns credentials, reads
and updates Google Sheets, controls Puppeteer, and uses Claude only as a fallback
for uncertain link and field classification.
