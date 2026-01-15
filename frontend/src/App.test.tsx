// Temporary test component
export default function TestApp() {
  return (
    <div style={{ padding: '2rem', background: 'white', color: 'black' }}>
      <h1>Test - If you see this, React is working</h1>
      <p>The white screen issue might be related to:</p>
      <ul>
        <li>CSS loading issues</li>
        <li>Component rendering errors</li>
        <li>Router configuration</li>
      </ul>
    </div>
  );
}