import './globals.css';

export const metadata = {
  title: 'Permitting Scope Map',
  description: 'GIS proximity analysis and permit recommendations for utility construction',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
