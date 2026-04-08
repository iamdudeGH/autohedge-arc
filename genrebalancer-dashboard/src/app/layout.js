import './globals.css';

export const metadata = {
  title: 'GenRebalancer x Arc',
  description: 'Cross-chain AI treasury manager on GenLayer and Arc Networks',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
