import { memo, useMemo, useState } from "react";
import { Icon } from "../../../components/common";
import "./EntitySection.css";

// ---------------------------------------------------------------------------
// Types matching the entity extraction JSON shape
// ---------------------------------------------------------------------------

interface PersonDetail {
  detail: string;
  category: string;
}

interface PersonQuote {
  text: string;
  context: string;
}

interface ExtractedPerson {
  name: string;
  aliases: string[];
  role: "sender" | "recipient" | "mentioned";
  relationship_to_sender: string | null;
  details: PersonDetail[];
  emotional_significance: string | null;
  quotes: PersonQuote[];
  confidence: number;
  narrative?: string;
}

interface ExtractedPlace {
  name: string;
  type: "city" | "region" | "country" | "street" | "landmark" | "other";
  role: "written_from" | "mentioned" | "destination";
  why_mentioned: string;
  descriptive_details: string | null;
  associated_people: string[];
  confidence: number;
  narrative?: string;
}

interface DiscoveredRelationship {
  person_a: string;
  person_b: string;
  relationship_type: string;
  evidence: string;
  confidence: number;
}

interface PersonPlaceConnection {
  person_name: string;
  place_name: string;
  connection_type: string;
  evidence: string;
}

interface EntityExtractionData {
  people: ExtractedPerson[];
  places: ExtractedPlace[];
  relationships: DiscoveredRelationship[];
  person_place_connections: PersonPlaceConnection[];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EntitySectionProps {
  entityExtractionJson: unknown;
  reExtractState?: "idle" | "extracting" | "done";
  onReExtractEntities?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseEntityData(json: unknown): EntityExtractionData | null {
  if (!json || typeof json !== "object") return null;
  const data = json as Record<string, unknown>;
  if (!Array.isArray(data.people) && !Array.isArray(data.places)) return null;
  return {
    people: Array.isArray(data.people) ? (data.people as ExtractedPerson[]) : [],
    places: Array.isArray(data.places) ? (data.places as ExtractedPlace[]) : [],
    relationships: Array.isArray(data.relationships)
      ? (data.relationships as DiscoveredRelationship[])
      : [],
    person_place_connections: Array.isArray(data.person_place_connections)
      ? (data.person_place_connections as PersonPlaceConnection[])
      : [],
  };
}

function formatConfidence(c: number): string {
  return `${Math.round(c * 100)}%`;
}

function formatConnectionType(t: string): string {
  return t.replace(/_/g, " ");
}

function formatRelationshipType(t: string): string {
  return t.replace(/-/g, " ").replace(/_/g, " ");
}

const ROLE_LABELS: Record<string, string> = {
  sender: "Sender",
  recipient: "Recipient",
  mentioned: "Mentioned",
  written_from: "Written from",
  destination: "Destination",
};

// ---------------------------------------------------------------------------
// Person Card
// ---------------------------------------------------------------------------

function PersonCard({
  person,
  relationships,
  placeConnections,
}: {
  person: ExtractedPerson;
  relationships: DiscoveredRelationship[];
  placeConnections: PersonPlaceConnection[];
}) {
  const [expanded, setExpanded] = useState(false);

  // Filter relationships involving this person
  const personRelationships = relationships.filter(
    (r) => r.person_a === person.name || r.person_b === person.name
  );

  // Filter place connections for this person
  const personPlaces = placeConnections.filter(
    (c) => c.person_name === person.name
  );

  return (
    <div className="entity-card">
      <div
        className="entity-card-header"
        onClick={() => setExpanded(!expanded)}
      >
        <Icon
          name="chevron-right"
          size={14}
          className={`entity-card-chevron ${expanded ? "expanded" : ""}`}
        />
        <span className="entity-card-name">{person.name}</span>
        {person.aliases.length > 0 && (
          <span className="entity-confidence">
            aka {person.aliases.join(", ")}
          </span>
        )}
        <div className="entity-card-meta">
          <span className={`entity-badge role-${person.role}`}>
            {ROLE_LABELS[person.role] ?? person.role}
          </span>
          <span className="entity-confidence">
            {formatConfidence(person.confidence)}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="entity-card-body">
          {/* Narrative */}
          {person.narrative && (
            <div className="entity-narrative">{person.narrative}</div>
          )}

          {/* Emotional significance */}
          {person.emotional_significance && (
            <div className="entity-field-group">
              <span className="entity-detail-label">Emotional significance</span>
              <div className="entity-emotional">
                {person.emotional_significance}
              </div>
            </div>
          )}

          {/* Details grid */}
          {person.details.length > 0 && (
            <div className="entity-field-group">
              <span className="entity-detail-label">Details</span>
              <div className="entity-details-grid">
                {person.details.map((d, i) => (
                  <span key={i} className="entity-detail-tag">
                    <span className="entity-detail-category">
                      {d.category}
                    </span>
                    <span>{d.detail}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Quotes */}
          {person.quotes.length > 0 && (
            <div className="entity-field-group">
              <span className="entity-detail-label">Quotes</span>
              <div className="entity-quotes">
                {person.quotes.map((q, i) => (
                  <blockquote key={i} className="entity-quote">
                    <p>&ldquo;{q.text}&rdquo;</p>
                    {q.context && <cite>{q.context}</cite>}
                  </blockquote>
                ))}
              </div>
            </div>
          )}

          {/* Relationships */}
          {personRelationships.length > 0 && (
            <div className="entity-field-group">
              <span className="entity-detail-label">Relationships</span>
              <div className="entity-relationships">
                {personRelationships.map((r, i) => {
                  const otherPerson =
                    r.person_a === person.name ? r.person_b : r.person_a;
                  return (
                    <div key={i} className="entity-relationship-item">
                      <span className="entity-relationship-type">
                        {formatRelationshipType(r.relationship_type)}
                      </span>
                      <span>{otherPerson}</span>
                      {r.evidence && (
                        <span className="entity-relationship-evidence">
                          &mdash; {r.evidence}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Place connections */}
          {personPlaces.length > 0 && (
            <div className="entity-field-group">
              <span className="entity-detail-label">Places</span>
              <div className="entity-connections">
                {personPlaces.map((c, i) => (
                  <span key={i} className="entity-connection-tag">
                    <span className="entity-connection-type">
                      {formatConnectionType(c.connection_type)}
                    </span>
                    <span>{c.place_name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Place Card
// ---------------------------------------------------------------------------

function PlaceCard({
  place,
  placeConnections,
}: {
  place: ExtractedPlace;
  placeConnections: PersonPlaceConnection[];
}) {
  const [expanded, setExpanded] = useState(false);

  // Filter person connections for this place
  const placePeople = placeConnections.filter(
    (c) => c.place_name === place.name
  );

  return (
    <div className="entity-card">
      <div
        className="entity-card-header"
        onClick={() => setExpanded(!expanded)}
      >
        <Icon
          name="chevron-right"
          size={14}
          className={`entity-card-chevron ${expanded ? "expanded" : ""}`}
        />
        <span className="entity-card-name">{place.name}</span>
        <div className="entity-card-meta">
          <span className={`entity-badge type-${place.type}`}>
            {place.type}
          </span>
          <span className={`entity-badge role-${place.role}`}>
            {ROLE_LABELS[place.role] ?? place.role}
          </span>
          <span className="entity-confidence">
            {formatConfidence(place.confidence)}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="entity-card-body">
          {/* Narrative */}
          {place.narrative && (
            <div className="entity-narrative">{place.narrative}</div>
          )}

          {/* Why mentioned */}
          {place.why_mentioned && (
            <div className="entity-field-group">
              <span className="entity-detail-label">Why mentioned</span>
              <div className="entity-text-block">{place.why_mentioned}</div>
            </div>
          )}

          {/* Descriptive details */}
          {place.descriptive_details && (
            <div className="entity-field-group">
              <span className="entity-detail-label">Description</span>
              <div className="entity-text-block">
                {place.descriptive_details}
              </div>
            </div>
          )}

          {/* Associated people */}
          {place.associated_people.length > 0 && (
            <div className="entity-field-group">
              <span className="entity-detail-label">Associated people</span>
              <div className="entity-people-tags">
                {place.associated_people.map((name) => (
                  <span key={name} className="entity-person-tag">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Person connections to this place */}
          {placePeople.length > 0 && (
            <div className="entity-field-group">
              <span className="entity-detail-label">Connections</span>
              <div className="entity-connections">
                {placePeople.map((c, i) => (
                  <span key={i} className="entity-connection-tag">
                    <span>{c.person_name}</span>
                    <span className="entity-connection-type">
                      {formatConnectionType(c.connection_type)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EntitySection (exported)
// ---------------------------------------------------------------------------

const EntitySection = memo(function EntitySection({
  entityExtractionJson,
  reExtractState = "idle",
  onReExtractEntities,
}: EntitySectionProps) {
  const data = useMemo(
    () => parseEntityData(entityExtractionJson),
    [entityExtractionJson],
  );
  if (!data) return null;

  const totalPeople = data.people.length;
  const totalPlaces = data.places.length;
  if (totalPeople === 0 && totalPlaces === 0) return null;

  const countParts: string[] = [];
  if (totalPeople > 0)
    countParts.push(`${totalPeople} ${totalPeople === 1 ? "person" : "people"}`);
  if (totalPlaces > 0)
    countParts.push(`${totalPlaces} ${totalPlaces === 1 ? "place" : "places"}`);

  return (
    <div className="entity-section">
      <div className="entity-section-header">
        <Icon name="person" size={18} />
        <h2>Entities</h2>
        <span className="entity-count">{countParts.join(", ")}</span>
        {onReExtractEntities && (
          <button
            className={`action-btn entity-re-extract-btn ${reExtractState}`}
            onClick={onReExtractEntities}
            disabled={reExtractState === "extracting"}
            title="Regenerate entities from transcript"
          >
            {reExtractState === "extracting" ? (
              <>
                <Icon name="process" size={14} className="spinning" />
                <span>Regenerating...</span>
              </>
            ) : reExtractState === "done" ? (
              <>
                <Icon name="check" size={14} />
                <span>Done</span>
              </>
            ) : (
              <>
                <Icon name="process" size={14} />
                <span>Regenerate</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* People */}
      {totalPeople > 0 && (
        <div className="entity-subsection">
          <h4 className="entity-subsection-title">People</h4>
          {data.people.map((person) => (
            <PersonCard
              key={person.name}
              person={person}
              relationships={data.relationships}
              placeConnections={data.person_place_connections}
            />
          ))}
        </div>
      )}

      {/* Places */}
      {totalPlaces > 0 && (
        <div className="entity-subsection">
          <h4 className="entity-subsection-title">Places</h4>
          {data.places.map((place) => (
            <PlaceCard
              key={place.name}
              place={place}
              placeConnections={data.person_place_connections}
            />
          ))}
        </div>
      )}
    </div>
  );
});

EntitySection.displayName = "EntitySection";

export default EntitySection;
