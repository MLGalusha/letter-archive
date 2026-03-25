import { Link } from 'react-router-dom';

interface PersonData {
  id: string;
  name: string;
  biography: string | null;
  letterCount: number;
  roles: { sender: number; recipient: number };
}

interface KeyPeopleSectionProps {
  people: PersonData[];
}

function KeyPeopleSection({ people }: KeyPeopleSectionProps) {
  if (people.length === 0) return null;

  return (
    <section className="cp-key-people">
      <h3 className="cp-key-people-title">Key People</h3>
      <div className="cp-people-scroll">
        {people.map((person) => (
          <Link
            key={person.id}
            to={`/people/${person.id}`}
            className="cp-person-card"
          >
            <h4 className="cp-person-name">{person.name}</h4>
            {person.biography && (
              <p className="cp-person-bio">{person.biography}</p>
            )}
            <div className="cp-person-stats">
              <span className="cp-person-stat">
                {person.letterCount} letter{person.letterCount !== 1 ? 's' : ''}
              </span>
              {person.roles.sender > 0 && (
                <span className="cp-person-stat">
                  {person.roles.sender} sent
                </span>
              )}
              {person.roles.recipient > 0 && (
                <span className="cp-person-stat">
                  {person.roles.recipient} received
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default KeyPeopleSection;
