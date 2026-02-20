import { useState, useRef, type KeyboardEvent } from "react";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

export default function TagInput({ tags, onChange }: TagInputProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInputValue("");
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1);
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setInputValue("");
    }
  };

  const handleAddClick = () => {
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className="tag-input">
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          className="tag-input__field"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (inputValue.trim()) addTag(inputValue);
            setIsEditing(false);
          }}
          placeholder="tag name..."
        />
      ) : (
        <button
          type="button"
          className="tag-input__add"
          onClick={handleAddClick}
        >
          <span className="tag-input__plus">+</span><span>New</span>
        </button>
      )}
      {tags.map((tag, index) => (
        <span key={tag} className="tag-input__chip">
          {tag}
          <button
            type="button"
            className="tag-input__remove"
            onClick={() => removeTag(index)}
            aria-label={`Remove ${tag}`}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
