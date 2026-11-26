import Link from 'next/link'
import DartboardArt from '@/components/DartboardArt'
import Icon from '@/components/Icon'
import ResumeMatch from '@/components/ResumeMatch'

const activities = [
  { href: '/create?mode=practice', icon: 'target', label: 'Solo training', title: 'Practice', description: 'Work on doubles, trebles, or your finishing.' },
  { href: '/daily-checkout', icon: 'daily', label: 'Daily challenge', title: 'Daily checkout', description: 'Take on a new finish every day.' },
  { href: '/tournaments', icon: 'trophy', label: 'Competition', title: 'Tournaments', description: 'Set up a bracket and play to the final.' },
] as const

export default function HomePage() {
  return (
    <main className="homePage">
      <section className="homeHero" aria-labelledby="home-heading">
        <DartboardArt />
        <div className="heroNotation" aria-hidden="true"><span>01 / X01</span><b>501</b><span>DOUBLE OUT</span></div>
        <div className="homeHeroCopy">
          <span className="eyebrow"><i /> The darts scoring app</span>
          <h1 id="home-heading">Game <em>on.</em></h1>
          <p>Score a match on the same board or play with friends from anywhere.</p>
          <div className="homeHeroActions">
            <Link className="btn btnPrimary" href="/create"><Icon name="plus" /> New match</Link>
            <Link className="btn btnHeroSecondary" href="/join"><Icon name="key" /> Join with code</Link>
            <ResumeMatch />
          </div>
          <div className="row">
            <Link className="homeBrowse" href="/my-matches">My matches <Icon name="arrow" /></Link>
            <Link className="homeBrowse" href="/lobbies">Browse public lobbies <Icon name="arrow" /></Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="play-heading">
        <div className="homeSectionHead"><h2 id="play-heading">More ways to play</h2></div>
        <div className="homeModeRail">
          {activities.map((activity) => (
            <Link className="activityCard" href={activity.href} key={activity.href}>
              <span className="activityIcon"><Icon name={activity.icon} /></span>
              <span className="activityLabel">{activity.label}</span>
              <strong>{activity.title}</strong>
              <span className="activityDescription">{activity.description}</span>
              <span className="activityArrow"><Icon name="arrow" /></span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}
