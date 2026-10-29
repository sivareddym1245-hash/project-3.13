# FridgePolice

A roommate-friendly fridge inventory prototype for portion requests, approvals, spoilage, item identity, and inventory reconciliation.

## Run locally

```sh
npm test
python -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000) in a browser. The prototype stores its demo state in browser local storage; use **Reset demo** to restore the sample fridge.

See [Changes.md](./Changes.md) for scenario handling and implementation decisions.
