# OSS Janitor 🧹

OSS Janitor helps you analyze, understand, and clean up your open-source dependencies.

It starts simple — inspecting your direct dependencies — and evolves into a full dependency intelligence tool for modern projects.

## ✨ Why OSS Janitor?

Modern projects quickly accumulate dependencies. Over time, this leads to:

- 📦 bloated bundles
- ⚠️ security vulnerabilities
- 📜 unclear or risky licenses
- 🧟 unmaintained packages

OSS Janitor gives you visibility and actionable cleanup insights.

## 🚀 Current Features (Prototype)

- Analyze direct dependencies from package.json
- Works in npm workspace monorepos
- CLI-first workflow
- Lightweight and fast

## 🧭 Vision

OSS Janitor is evolving into a full dependency analysis platform:

🔍 Deep Analysis

- Full dependency graph (including transitive deps)
- Dependency tree visualization

🔐 Security

- Vulnerability detection
- Risk scoring

📜 Licensing

- License detection and compatibility checks
- Alerts for restrictive or conflicting licenses

❤️ Package Health

- Maintenance status (last update, activity)
- Popularity and ecosystem signals

🧹 Cleanup Intelligence

- Detect unused dependencies
- Suggest removals and alternatives
- Identify duplicate or redundant packages

🌍 Multi-Ecosystem Support

- JavaScript (npm/yarn/pnpm)
- .NET (NuGet / C#)

## 🛠 Installation

Use locally:

```bash
npm run build
npm run scan -- .
```

🧪 Project Status

⚠️ Early prototype

Currently focused on:

- direct dependency analysis
- CLI ergonomics

Expect rapid changes.

## 🗺 Roadmap

- Transitive dependency analysis
- Vulnerability integration
- License engine
- Package health scoring
- Auto-fix / cleanup suggestions
- NuGet support

## 🤝 Contributing

Contributions are welcome!

Ideas, issues, and PRs are encouraged — especially around:

- dependency analysis logic
- CLI UX improvements
- ecosystem integrations

---

📄 License

[MIT](LICENSE)
