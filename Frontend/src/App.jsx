import { useState } from 'react';

function App() {
  const [search, setSearch] = useState('');
  const [price, setPrice] = useState(null);

  const handleSearch = async () => {
    if (!search) return;
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/v1/price/${search}`);
      const data = await res.json();
      setPrice(data.price);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-10">
      <h1 className="text-3xl font-bold mb-4">AI Trade Assistant</h1>

      <div className="flex gap-2 mb-6">
        <input
          type="text"
          placeholder="Enter Symbol (e.g., TSLA)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="p-2 rounded bg-gray-700 text-white"
        />
        <button
          onClick={handleSearch}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
        >
          Search
        </button>
      </div>

      {price !== null && (
        <div className="text-2xl">
          📈 Current Price for {search.toUpperCase()}: <span className="font-bold">${price}</span>
        </div>
      )}
    </div>
  );
}

export default App;
