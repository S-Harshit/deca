# Deca web app

React + TypeScript + Vite client for [Deca](../README.md). The server that hosts it is in `../dema-server`.

```bash
npm ci
npm run dev      # hot reload on self-signed https (HTTP=1 for plain http)
npm run build    # type-check + production bundle into dist/
npx eslint src
```

Everything about how it works (sync model, protocol, security) is in [../docs/SPEC.md](../docs/SPEC.md).
