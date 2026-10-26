import { XIcon } from "lucide-react";
import { useState } from "react";

/** Inline tag chips: Enter, comma or space adds; Backspace on an empty input removes the last. */
export function TagsEditor({
  tags,
  onChange,
}: {
  tags: ReadonlyArray<string>;
  onChange: (tags: Array<string>) => void;
}) {
  const [text, setText] = useState("");

  const commit = () => {
    const tag = text.trim().replace(/^#/, "");
    setText("");
    if (tag !== "" && !tags.includes(tag)) onChange([...tags, tag]);
  };

  return (
    <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-0.5 font-mono text-xs focus-within:bg-muted/60">
      {tags.map((tag) => (
        <span
          key={tag}
          className="group/tag flex max-w-44 items-center gap-0.5 rounded-sm bg-muted py-0.5 pr-0.5 pl-1.5 text-muted-foreground"
        >
          <span className="truncate">#{tag}</span>
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            className="rounded-sm p-0.5 opacity-50 group-hover/tag:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
            onClick={() => onChange(tags.filter((entry) => entry !== tag))}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <input
        aria-label="Add tag"
        value={text}
        placeholder={tags.length === 0 ? "#add tag" : "#tag"}
        className="w-16 min-w-12 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70 md:text-xs"
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "," || event.key === " ") {
            event.preventDefault();
            commit();
          } else if (event.key === "Backspace" && text === "" && tags.length > 0) {
            onChange(tags.slice(0, -1));
          } else if (event.key === "Escape") {
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
