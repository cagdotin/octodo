import { XIcon } from "lucide-react";
import { useState } from "react";
import { Chip } from "@/components/task-bits";

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
    <div className="flex min-h-7 flex-wrap items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-muted focus-within:bg-muted">
      {tags.map((tag) => (
        <Chip key={tag} className="pr-0.5 text-foreground">
          <span className="truncate">{tag}</span>
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => onChange(tags.filter((entry) => entry !== tag))}
          >
            <XIcon className="size-3" />
          </button>
        </Chip>
      ))}
      <input
        aria-label="Add tag"
        value={text}
        placeholder={tags.length === 0 ? "Add tags" : "Add…"}
        className="min-w-12 flex-1 bg-transparent px-0.5 text-base outline-none placeholder:text-muted-foreground md:text-sm"
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
