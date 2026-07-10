import { ArrowLeft } from 'lucide-react'
import { NavLink } from 'react-router-dom'

// Small "back to X" link for pages reached from a hub (e.g. the PDF tools).
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className="inline-flex items-center gap-1.5 text-xs xl:text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
    >
      <ArrowLeft className="size-3.5" />
      {label}
    </NavLink>
  )
}
