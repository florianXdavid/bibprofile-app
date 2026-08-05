// Shared frame for every report card: title, optional collapsible behaviour,
// the card body, and a consistent "Based on N works, X flagged as uncertain"
// footer driven by the shared denominator helper. Keeping the footer here means
// every card reports its own n the same honest way.

import type { ReactNode } from 'react'
import { describeBasis, type Stat } from '../../lib/stats/denominator'

interface Props {
  title: string
  intro?: ReactNode
  basis?: Stat // renders the standard denominator footer
  collapsible?: boolean
  defaultOpen?: boolean
  children: ReactNode
}

function Body({ intro, basis, children }: Pick<Props, 'intro' | 'basis' | 'children'>) {
  return (
    <>
      {intro && <p className="card-intro">{intro}</p>}
      {children}
      {basis && <p className="card-basis">{describeBasis(basis)}</p>}
    </>
  )
}

export default function CardShell({ title, intro, basis, collapsible, defaultOpen = false, children }: Props) {
  if (collapsible) {
    return (
      <details className="card" open={defaultOpen}>
        <summary className="card-title">{title}</summary>
        <Body intro={intro} basis={basis}>{children}</Body>
      </details>
    )
  }
  return (
    <section className="card">
      <h3 className="card-title">{title}</h3>
      <Body intro={intro} basis={basis}>{children}</Body>
    </section>
  )
}
