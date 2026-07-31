ALTER TABLE "page_geometry_proposals"
  ADD CONSTRAINT "page_geometry_proposal_candidates_in_image_strict"
  CHECK (
    NOT jsonb_path_exists(
      "artifact",
      '$.candidates[*] ? (
        @.bbox[0] < 0
        || @.bbox[1] < 0
        || @.bbox[2] <= @.bbox[0]
        || @.bbox[3] <= @.bbox[1]
        || @.bbox[2] > $width
        || @.bbox[3] > $height
      )',
      jsonb_build_object(
        'width',
        ("artifact"#>>'{source,image,width}')::numeric,
        'height',
        ("artifact"#>>'{source,image,height}')::numeric
      )
    )
    AND NOT jsonb_path_exists(
      "artifact",
      'strict $.candidates[*]
        ? (exists(@.baseline)).baseline[*] ? (
        @[0] < 0 || @[1] < 0 || @[0] > $width || @[1] > $height
      )',
      jsonb_build_object(
        'width',
        ("artifact"#>>'{source,image,width}')::numeric,
        'height',
        ("artifact"#>>'{source,image,height}')::numeric
      )
    )
    AND NOT jsonb_path_exists(
      "artifact",
      '$.candidates[*].boundary[*] ? (
        @.x < 0 || @.y < 0 || @.x > $width || @.y > $height
      )',
      jsonb_build_object(
        'width',
        ("artifact"#>>'{source,image,width}')::numeric,
        'height',
        ("artifact"#>>'{source,image,height}')::numeric
      )
    )
  ) NOT VALID;

ALTER TABLE "page_geometry_proposals"
  VALIDATE CONSTRAINT "page_geometry_proposal_candidates_in_image_strict";

ALTER TABLE "page_geometry_proposals"
  DROP CONSTRAINT "page_geometry_proposal_candidates_in_image";

ALTER TABLE "page_geometry_proposals"
  RENAME CONSTRAINT "page_geometry_proposal_candidates_in_image_strict"
  TO "page_geometry_proposal_candidates_in_image";
