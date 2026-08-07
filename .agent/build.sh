#!/usr/bin/env bash
set -euo pipefail

# .agent/rules を連結し、各コーディングエージェントのルールを生成する。
RULES_DIR=".agent/rules"
OUTPUT_FILES=("AGENTS.md" "CLAUDE.md")

END='それでは、指示に従ってタスクを遂行してください。

<指示>
{{instructions}}'

mapfile -t rule_files < <(printf '%s\n' "$RULES_DIR"/*.md | sort)

for output_file in "${OUTPUT_FILES[@]}"; do
	: > "$output_file"

	for rule_file in "${rule_files[@]}"; do
		cat "$rule_file" >> "$output_file"
		printf '\n\n' >> "$output_file"
	done

	printf '%s\n' "$END" >> "$output_file"
done

printf 'Generated %s from %d rule files\n' "${OUTPUT_FILES[*]}" "${#rule_files[@]}"
