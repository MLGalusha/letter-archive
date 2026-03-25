interface ReadingPath {
  title: string;
  description: string;
  letterIds: string[];
}

interface ReadingPathsSectionProps {
  paths: ReadingPath[];
}

function ReadingPathsSection({ paths }: ReadingPathsSectionProps) {
  if (paths.length === 0) return null;

  return (
    <section className="cp-reading-paths">
      <h3 className="cp-reading-paths-title">Reading Paths</h3>
      <div className="cp-paths-grid">
        {paths.map((path, i) => (
          <div key={i} className="cp-path-card">
            <h4 className="cp-path-card-title">{path.title}</h4>
            <p className="cp-path-card-desc">{path.description}</p>
            <span className="cp-path-card-count">
              {path.letterIds.length} letter{path.letterIds.length !== 1 ? 's' : ''}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default ReadingPathsSection;
