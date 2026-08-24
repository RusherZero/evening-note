import { EveningNoteApp } from './components/evening-note-app';

// The shell contains only client-side data access, so it is safe to export as
// static HTML for GitHub Pages.
export const dynamic = 'force-static';

export default function Home() {
  return <EveningNoteApp />;
}
