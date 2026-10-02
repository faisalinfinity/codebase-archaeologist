import Link from 'next/link';

import { RepoUrlForm } from '@/components/repo-url-form';
import { Button } from '@/components/ui/button';

const lenses = [
  {
    name: 'WHAT',
    body: 'What this repository actually does — modules, entry points, and the jobs it performs.',
  },
  {
    name: 'WHY',
    body: 'Why a symbol exists, grounded in commits, pull requests, and issues — not guesswork.',
  },
  {
    name: 'HOW',
    body: 'How a request or data flow moves through the system, with file and line citations.',
  },
  {
    name: 'WHAT CHANGED',
    body: 'How the design evolved: history, blame, and the evidence behind a change.',
  },
  {
    name: 'IMPACT',
    body: 'What else would move if you changed this file or symbol.',
  },
];

export default function HomePage() {
  return (
    <main>
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-16 md:py-24">
        <div className="max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">
            Public GitHub, read-only
          </p>
          <h1 className="mt-4 font-serif text-4xl font-semibold tracking-tight text-foreground md:text-6xl">
            Excavate a codebase. Don’t chat with a blob of files.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
            Paste a public GitHub URL to index source and docs. Browse files, symbols, and imports,
            then search the indexed source. History, impact analysis, and AI answers are being
            built.
          </p>
        </div>
        <RepoUrlForm />
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/login">Analyze repository</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/repositories/new">Add a repository</Link>
          </Button>
        </div>
      </section>

      <section className="border-t border-border bg-card/40">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-16 md:grid-cols-5">
          {lenses.map((lens) => (
            <div key={lens.name} className="flex flex-col gap-2">
              <h2 className="font-serif text-lg text-primary">{lens.name}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{lens.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-16 md:grid-cols-3">
        {[
          [
            'Code understanding',
            'AST-aware parsing and a code graph — not a generic dump into a vector store.',
          ],
          ['Git history', 'Commits and PRs as first-class evidence for “why was this written?”'],
          ['Citations', 'Every answer must point at exact files and lines we actually indexed.'],
          ['Impact analysis', 'Ask what depends on a symbol before you change it.'],
          [
            'Multiple AI providers',
            'Demo AI (server-side key), BYOK, or an OpenAI-compatible endpoint.',
          ],
          [
            'Never execute untrusted code',
            'Read, parse, analyze, embed. Repository scripts never run.',
          ],
        ].map(([title, body]) => (
          <div key={title} className="rounded-lg border border-border bg-card p-5">
            <h3 className="font-medium text-foreground">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
