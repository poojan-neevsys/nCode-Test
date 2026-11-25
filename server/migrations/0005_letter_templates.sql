-- AB#letter-templates, criterion 1: welcome letter templates. Bodies are plain text.
-- The name is unique. Only a new table is created, so existing rows are not changed.
CREATE TABLE letter_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- AB#letter-templates, criterion 1: the seeded template uses no compensation placeholders.
INSERT INTO letter_templates (name, body) VALUES (
  'Standard welcome letter',
  'Dear {{firstName}} {{lastName}},

We are pleased to welcome you to NeevSys as {{jobTitle}} in {{department}}.
Your start date is {{startDate}}.

Please contact HR if you have any questions before your first day.

Kind regards,
HR Team'
);
