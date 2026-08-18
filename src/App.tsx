import { useState } from "react";

export default function App() {
  const [profile, setProfile] = useState("Default");

  return (
    <main style={{ padding: 32, fontFamily: "Arial" }}>
      <h1>Unnamed Desktop App</h1>
      <p>Mouse configuration utility</p>
      <label>
        Profile: {profile}
        <button onClick={() => setProfile("Gaming")}>Switch</button>
      </label>
    </main>
  );
}
