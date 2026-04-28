import React, { useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
} from "react-native";
import { EnrichedMarkdownText, type MarkdownStyle } from "react-native-enriched-markdown";
import { SafeAreaView } from "react-native-safe-area-context";

import { Colors, Fonts, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type AppTheme = (typeof Colors)[keyof typeof Colors];
type EditorMode = "edit" | "preview";
type NoteListItem = {
  title: string;
  folder: string;
  excerpt: string;
  updated: string;
};
type InlineSegment =
  | { type: "text"; text: string }
  | { type: "code"; marker: string; text: string }
  | { type: "strong"; marker: string; text: string }
  | { type: "em"; marker: string; text: string }
  | { type: "strongEm"; marker: string; text: string }
  | { type: "strike"; marker: string; text: string }
  | { type: "link"; before: string; label: string; after: string };

const InitialMarkdown = `# Untitled note

Start writing. Use **bold**, _italic_, ~~strike~~, \`code\`, and [links](https://example.com).

- [x] GitHub task lists
- [ ] Tables and fenced code blocks

> A quiet editor should make the text feel close.

\`\`\`ts
const note = "plain markdown";
\`\`\`
`;

const Notes: NoteListItem[] = [
  {
    title: "Untitled note",
    folder: "Drafts",
    excerpt: "Start writing. Use bold, italic, strike, code, and links.",
    updated: "Now",
  },
  {
    title: "Back Pain Fix",
    folder: "Health",
    excerpt: "Elbow stack stretching, Mackenzie exercises, Feb update.",
    updated: "Yesterday",
  },
  {
    title: "Better portfolio website",
    folder: "Projects",
    excerpt: "Tighter case studies, fewer decorative sections, stronger proof.",
    updated: "Mon",
  },
  {
    title: "How to learn LLMs",
    folder: "Clippings",
    excerpt: "Roadmap from zero to fine-tuning and evaluation loops.",
    updated: "Apr 22",
  },
  {
    title: "Goals for 2026",
    folder: "Personal",
    excerpt: "Health, craft, focus, money, and the work that compounds.",
    updated: "Apr 18",
  },
];

const NotesPanelWidth = Dimensions.get("window").width;

function createMarkdownStyle(theme: AppTheme): MarkdownStyle {
  return {
    paragraph: {
      color: theme.text,
      fontFamily: Fonts.serif,
      fontSize: 18,
      lineHeight: 28,
      marginTop: 0,
      marginBottom: Spacing.three,
    },
    h1: {
      color: theme.text,
      fontFamily: Fonts.serifSemiBold,
      fontSize: 34,
      fontWeight: "600",
      lineHeight: 40,
      marginTop: 0,
      marginBottom: Spacing.three,
    },
    h2: {
      color: theme.text,
      fontFamily: Fonts.serifSemiBold,
      fontSize: 26,
      fontWeight: "600",
      lineHeight: 32,
      marginTop: Spacing.two,
      marginBottom: Spacing.two,
    },
    h3: {
      color: theme.text,
      fontFamily: Fonts.serifSemiBold,
      fontSize: 22,
      fontWeight: "600",
      lineHeight: 28,
      marginTop: Spacing.two,
      marginBottom: Spacing.two,
    },
    h4: {
      color: theme.text,
      fontFamily: Fonts.serifSemiBold,
      fontSize: 20,
      fontWeight: "600",
      lineHeight: 26,
      marginTop: Spacing.two,
      marginBottom: Spacing.two,
    },
    h5: {
      color: theme.text,
      fontFamily: Fonts.serifSemiBold,
      fontSize: 18,
      fontWeight: "600",
      lineHeight: 24,
      marginTop: Spacing.two,
      marginBottom: Spacing.two,
    },
    h6: {
      color: theme.textSecondary,
      fontFamily: Fonts.serifSemiBold,
      fontSize: 18,
      fontWeight: "600",
      lineHeight: 24,
      marginTop: Spacing.two,
      marginBottom: Spacing.two,
    },
    list: {
      color: theme.text,
      fontFamily: Fonts.serif,
      fontSize: 18,
      lineHeight: 28,
      markerColor: theme.textFaint,
      markerMinWidth: 24,
      gapWidth: Spacing.two,
      marginLeft: Spacing.one,
    },
    blockquote: {
      color: theme.textSecondary,
      backgroundColor: theme.backgroundElement,
      borderColor: theme.hairlineStrong,
      borderWidth: 2,
      fontFamily: Fonts.serif,
      fontSize: 18,
      gapWidth: Spacing.three,
      lineHeight: 28,
      marginBottom: Spacing.three,
    },
    code: {
      color: theme.text,
      backgroundColor: theme.active,
      borderColor: theme.hairline,
      fontFamily: Fonts.mono,
      fontSize: 16,
    },
    codeBlock: {
      color: theme.text,
      backgroundColor: theme.backgroundElement,
      borderColor: theme.hairlineStrong,
      borderRadius: Spacing.one,
      borderWidth: 1,
      fontFamily: Fonts.mono,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: Spacing.three,
      padding: Spacing.three,
    },
    link: {
      color: theme.accent,
      underline: true,
    },
    strong: {
      color: theme.text,
      fontFamily: Fonts.serifSemiBold,
      fontWeight: "normal",
    },
    em: {
      color: theme.text,
      fontFamily: Fonts.serifItalic,
      fontStyle: "normal",
    },
    strikethrough: {
      color: theme.textSecondary,
    },
    table: {
      color: theme.text,
      borderColor: theme.hairlineStrong,
      borderRadius: Spacing.one,
      borderWidth: 1,
      cellPaddingHorizontal: Spacing.two,
      cellPaddingVertical: Spacing.two,
      fontFamily: Fonts.serif,
      fontSize: 15,
      headerBackgroundColor: theme.active,
      headerTextColor: theme.text,
      lineHeight: 22,
      rowEvenBackgroundColor: theme.background,
      rowOddBackgroundColor: theme.backgroundElement,
    },
    taskList: {
      borderColor: theme.textSecondary,
      checkedColor: theme.accent,
      checkedStrikethrough: true,
      checkedTextColor: theme.textSecondary,
      checkmarkColor: theme.background,
    },
    thematicBreak: {
      color: theme.hairlineStrong,
      height: 1,
      marginBottom: Spacing.three,
      marginTop: Spacing.three,
    },
  };
}

export function MarkdownEditor() {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  const notesTranslateX = useRef(new Animated.Value(-NotesPanelWidth)).current;
  const [markdown, setMarkdown] = useState(InitialMarkdown);
  const [mode, setMode] = useState<EditorMode>("preview");
  const [notesOpen, setNotesOpen] = useState(false);
  const markdownStyle = useMemo(() => createMarkdownStyle(theme), [theme]);

  const openNotes = () => {
    Keyboard.dismiss();
    setNotesOpen(true);
    Animated.timing(notesTranslateX, {
      duration: 180,
      toValue: 0,
      useNativeDriver: true,
    }).start();
  };

  const closeNotes = () => {
    Animated.timing(notesTranslateX, {
      duration: 150,
      toValue: -NotesPanelWidth,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setNotesOpen(false);
      }
    });
  };

  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: ({ nativeEvent }, gesture) => {
          const horizontalSwipe =
            Math.abs(gesture.dx) > 16 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4;
          const openingFromEdge = !notesOpen && nativeEvent.pageX < 32 && gesture.dx > 0;
          const closingPanel = notesOpen && gesture.dx < 0;

          return horizontalSwipe && (openingFromEdge || closingPanel);
        },
        onPanResponderRelease: (_event, gesture) => {
          if (!notesOpen && gesture.dx > 56) {
            Keyboard.dismiss();
            openNotes();
          }
          if (notesOpen && gesture.dx < -48) {
            closeNotes();
          }
        },
      }),
    [notesOpen],
  );

  const enterEditMode = () => {
    setMode("edit");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const enterPreviewMode = () => {
    Keyboard.dismiss();
    setMode("preview");
  };

  const isEditing = mode === "edit";

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.background }]}
      {...swipeResponder.panHandlers}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardView}
      >
        {isEditing ? (
          <ScrollView
            contentContainerStyle={styles.sourceContent}
            keyboardShouldPersistTaps="handled"
            style={styles.source}
          >
            <View style={styles.sourceLayer}>
              <StyledMarkdownSource markdown={markdown} theme={theme} />
              <TextInput
                ref={inputRef}
                autoCapitalize="sentences"
                cursorColor={theme.accent}
                multiline
                onChangeText={setMarkdown}
                placeholder="Start writing..."
                placeholderTextColor={theme.textFaint}
                scrollEnabled={false}
                selectionColor={theme.selection}
                style={[styles.sourceInput, { color: "transparent" }]}
                textAlignVertical="top"
                value={markdown}
              />
            </View>
          </ScrollView>
        ) : (
          <ScrollView
            contentContainerStyle={styles.previewContent}
            keyboardShouldPersistTaps="handled"
            style={styles.preview}
          >
            <EnrichedMarkdownText
              flavor="github"
              markdown={markdown.trim().length > 0 ? markdown : "Nothing to preview yet."}
              markdownStyle={markdownStyle}
              selectable
            />
          </ScrollView>
        )}

        <Pressable
          accessibilityLabel={isEditing ? "Preview note" : "Edit note"}
          accessibilityRole="button"
          onPress={isEditing ? enterPreviewMode : enterEditMode}
          style={[
            styles.modeButton,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.hairlineStrong,
              shadowColor: theme.text,
            },
          ]}
        >
          {isEditing ? (
            <PreviewIcon color={theme.textSecondary} accentColor={theme.accent} />
          ) : (
            <EditIcon color={theme.textSecondary} accentColor={theme.accent} />
          )}
        </Pressable>
      </KeyboardAvoidingView>

      {notesOpen && (
        <View style={styles.notesOverlay}>
          <Pressable
            accessibilityLabel="Close notes"
            onPress={closeNotes}
            style={styles.notesScrim}
          />
          <Animated.View
            style={[
              styles.notesAnimatedPanel,
              {
                transform: [{ translateX: notesTranslateX }],
              },
            ]}
          >
            <NotesPanel notes={Notes} onClose={closeNotes} theme={theme} />
          </Animated.View>
        </View>
      )}
    </SafeAreaView>
  );
}

function NotesPanel({
  notes,
  onClose,
  theme,
}: {
  notes: NoteListItem[];
  onClose: () => void;
  theme: AppTheme;
}) {
  return (
    <View
      style={[
        styles.notesPanel,
        {
          backgroundColor: theme.background,
          borderRightColor: theme.hairline,
          shadowColor: theme.text,
        },
      ]}
    >
      <View style={[styles.notesHeader, { borderBottomColor: theme.hairline }]}>
        <Text style={[styles.notesTitle, { color: theme.textSecondary }]}>Notes</Text>
        <Pressable
          accessibilityLabel="Close notes"
          onPress={onClose}
          style={styles.notesCloseButton}
        >
          <CloseIcon color={theme.textSecondary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.notesList}>
        {notes.map((note, index) => (
          <Pressable
            key={note.title}
            onPress={onClose}
            style={[
              styles.noteRow,
              {
                backgroundColor: index === 0 ? theme.active : theme.background,
                borderBottomColor: theme.hairline,
              },
            ]}
          >
            <View style={styles.noteRowTop}>
              <Text numberOfLines={1} style={[styles.noteTitle, { color: theme.text }]}>
                {note.title}
              </Text>
              <Text style={[styles.noteDate, { color: theme.textFaint }]}>{note.updated}</Text>
            </View>
            <Text style={[styles.noteFolder, { color: theme.accent }]}>{note.folder}</Text>
            <Text numberOfLines={2} style={[styles.noteExcerpt, { color: theme.textSecondary }]}>
              {note.excerpt}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function StyledMarkdownSource({ markdown, theme }: { markdown: string; theme: AppTheme }) {
  if (markdown.length === 0) {
    return (
      <Text style={[styles.sourceText, { color: theme.textSecondary }]}>Start writing...</Text>
    );
  }

  const lines = markdown.split("\n");
  let inCodeBlock = false;

  return (
    <Text style={[styles.sourceText, { color: theme.text }]}>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        const isFence = trimmed.startsWith("```");
        const isCode = inCodeBlock || isFence;
        const lineStyle = getLineStyle(line, isCode, theme);

        if (isFence) {
          inCodeBlock = !inCodeBlock;
        }

        return (
          <Text key={`${index}-${line}`} style={lineStyle}>
            {isCode ? line : renderInlineSource(line, theme)}
            {index < lines.length - 1 ? "\n" : ""}
          </Text>
        );
      })}
    </Text>
  );
}

function getLineStyle(line: string, isCode: boolean, theme: AppTheme): TextStyle {
  const trimmed = line.trim();

  if (isCode) {
    return {
      backgroundColor: theme.active,
      fontFamily: Fonts.mono,
      fontSize: 16,
      lineHeight: 31,
    };
  }
  if (/^#{1,6}\s/.test(trimmed)) {
    return {
      fontFamily: Fonts.serifSemiBold,
      fontWeight: "600",
    };
  }
  if (/^>\s?/.test(trimmed)) {
    return {
      color: theme.textSecondary,
    };
  }
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
    return {
      color: theme.textSecondary,
      fontFamily: Fonts.mono,
    };
  }
  if (/^\|.*\|$/.test(trimmed)) {
    return {
      fontFamily: Fonts.mono,
      fontSize: 16,
      lineHeight: 31,
    };
  }

  return {};
}

function renderInlineSource(line: string, theme: AppTheme) {
  return parseInlineSource(line).map((segment, index) =>
    renderInlineSegment(segment, index, theme),
  );
}

function parseInlineSource(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let rest = text;

  while (rest.length > 0) {
    const match = findNextInlineMatch(rest);

    if (!match) {
      segments.push({ type: "text", text: rest });
      break;
    }

    if (match.index > 0) {
      segments.push({ type: "text", text: rest.slice(0, match.index) });
    }

    segments.push(match.segment);
    rest = rest.slice(match.index + match.raw.length);
  }

  return segments;
}

function findNextInlineMatch(text: string) {
  const patterns: Array<{
    regex: RegExp;
    create: (match: RegExpExecArray) => InlineSegment;
  }> = [
    {
      regex: /(`)([^`\n]+)(`)/,
      create: (match) => ({ type: "code", marker: match[1], text: match[2] }),
    },
    {
      regex: /(\*\*\*|___)(.+?)\1/,
      create: (match) => ({ type: "strongEm", marker: match[1], text: match[2] }),
    },
    {
      regex: /(\*\*|__)(.+?)\1/,
      create: (match) => ({ type: "strong", marker: match[1], text: match[2] }),
    },
    {
      regex: /(~~)(.+?)~~/,
      create: (match) => ({ type: "strike", marker: match[1], text: match[2] }),
    },
    {
      regex: /(!\[)([^\]]*)\]\(([^)]*)\)/,
      create: (match) => ({
        type: "link",
        before: match[1],
        label: match[2],
        after: `](${match[3]})`,
      }),
    },
    {
      regex: /(\[)([^\]]+)\]\(([^)]*)\)/,
      create: (match) => ({
        type: "link",
        before: match[1],
        label: match[2],
        after: `](${match[3]})`,
      }),
    },
    {
      regex: /(<https?:\/\/[^>\s]+>)/,
      create: (match) => ({ type: "link", before: "<", label: match[1].slice(1, -1), after: ">" }),
    },
    {
      regex: /(\*|_)([^*_]+?)\1/,
      create: (match) => ({ type: "em", marker: match[1], text: match[2] }),
    },
  ];

  return patterns
    .map((pattern) => {
      const match = pattern.regex.exec(text);
      if (!match) {
        return null;
      }
      return {
        index: match.index,
        raw: match[0],
        segment: pattern.create(match),
      };
    })
    .filter((match) => match !== null)
    .sort((a, b) => a.index - b.index)[0];
}

function renderInlineSegment(segment: InlineSegment, index: number, theme: AppTheme) {
  const markerStyle = [styles.inlineMarker, { color: theme.textFaint }];

  if (segment.type === "text") {
    return <Text key={index}>{segment.text}</Text>;
  }
  if (segment.type === "code") {
    return (
      <Text key={index}>
        <Text style={markerStyle}>{segment.marker}</Text>
        <Text style={[styles.inlineCode, { backgroundColor: theme.active }]}>{segment.text}</Text>
        <Text style={markerStyle}>{segment.marker}</Text>
      </Text>
    );
  }
  if (segment.type === "strong") {
    return (
      <Text key={index}>
        <Text style={markerStyle}>{segment.marker}</Text>
        <Text style={styles.inlineStrong}>{segment.text}</Text>
        <Text style={markerStyle}>{segment.marker}</Text>
      </Text>
    );
  }
  if (segment.type === "em") {
    return (
      <Text key={index}>
        <Text style={markerStyle}>{segment.marker}</Text>
        <Text style={styles.inlineEm}>{segment.text}</Text>
        <Text style={markerStyle}>{segment.marker}</Text>
      </Text>
    );
  }
  if (segment.type === "strongEm") {
    return (
      <Text key={index}>
        <Text style={markerStyle}>{segment.marker}</Text>
        <Text style={[styles.inlineStrong, styles.inlineEm]}>{segment.text}</Text>
        <Text style={markerStyle}>{segment.marker}</Text>
      </Text>
    );
  }
  if (segment.type === "strike") {
    return (
      <Text key={index}>
        <Text style={markerStyle}>{segment.marker}</Text>
        <Text style={[styles.inlineStrike, { color: theme.textSecondary }]}>{segment.text}</Text>
        <Text style={markerStyle}>{segment.marker}</Text>
      </Text>
    );
  }

  return (
    <Text key={index}>
      <Text style={markerStyle}>{segment.before}</Text>
      <Text style={[styles.inlineLink, { color: theme.accent }]}>{segment.label}</Text>
      <Text style={markerStyle}>{segment.after}</Text>
    </Text>
  );
}

function EditIcon({ color, accentColor }: { color: string; accentColor: string }) {
  return (
    <View style={[styles.editIconFrame, { borderColor: color }]}>
      <View style={[styles.editIconLine, { backgroundColor: color }]} />
      <View style={[styles.editIconLineShort, { backgroundColor: color }]} />
      <View style={[styles.editIconCaret, { backgroundColor: accentColor }]} />
    </View>
  );
}

function PreviewIcon({ color, accentColor }: { color: string; accentColor: string }) {
  return (
    <View style={styles.previewIconFrame}>
      <View style={[styles.previewIconLine, { backgroundColor: color }]} />
      <View style={[styles.previewIconLine, { backgroundColor: color }]} />
      <View style={[styles.previewIconRule, { backgroundColor: accentColor }]} />
    </View>
  );
}

function CloseIcon({ color }: { color: string }) {
  return (
    <View style={styles.closeIcon}>
      <View
        style={[styles.closeIconLine, { backgroundColor: color, transform: [{ rotate: "45deg" }] }]}
      />
      <View
        style={[
          styles.closeIconLine,
          { backgroundColor: color, transform: [{ rotate: "-45deg" }] },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },
  notesOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
  },
  notesScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  notesAnimatedPanel: {
    ...StyleSheet.absoluteFillObject,
  },
  notesPanel: {
    borderRightWidth: 0,
    height: "100%",
    shadowOffset: {
      width: 8,
      height: 0,
    },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    width: "100%",
    zIndex: 1,
  },
  notesHeader: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  notesTitle: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    letterSpacing: 0,
    lineHeight: 16,
  },
  notesCloseButton: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  notesList: {
    paddingBottom: Spacing.four,
  },
  noteRow: {
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  noteRowTop: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: Spacing.two,
    justifyContent: "space-between",
  },
  noteTitle: {
    flex: 1,
    fontFamily: Fonts.serifSemiBold,
    fontSize: 17,
    fontWeight: "600",
    lineHeight: 22,
  },
  noteDate: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    lineHeight: 16,
  },
  noteFolder: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    lineHeight: 18,
    marginTop: Spacing.one,
  },
  noteExcerpt: {
    fontFamily: Fonts.serif,
    fontSize: 14,
    lineHeight: 19,
    marginTop: Spacing.one,
  },
  source: {
    flex: 1,
  },
  sourceContent: {
    paddingBottom: 96,
  },
  sourceLayer: {
    minHeight: 420,
    position: "relative",
  },
  sourceText: {
    fontFamily: Fonts.serif,
    fontSize: 18,
    lineHeight: 31,
    minHeight: 420,
    padding: 0,
  },
  sourceInput: {
    ...StyleSheet.absoluteFillObject,
    fontFamily: Fonts.serif,
    fontSize: 18,
    lineHeight: 31,
    minHeight: 420,
    padding: 0,
  },
  inlineMarker: {
    fontFamily: Fonts.mono,
    fontSize: 14,
  },
  inlineStrong: {
    fontFamily: Fonts.serifSemiBold,
    fontWeight: "600",
  },
  inlineEm: {
    fontFamily: Fonts.serifItalic,
    fontStyle: "normal",
  },
  inlineCode: {
    borderRadius: Spacing.one,
    fontFamily: Fonts.mono,
    fontSize: 15,
  },
  inlineStrike: {
    textDecorationLine: "line-through",
  },
  inlineLink: {
    textDecorationLine: "underline",
  },
  preview: {
    flex: 1,
  },
  previewContent: {
    paddingBottom: 96,
  },
  modeButton: {
    alignItems: "center",
    borderRadius: 3,
    borderWidth: 1,
    bottom: Spacing.four,
    height: 44,
    justifyContent: "center",
    position: "absolute",
    right: Spacing.four,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    width: 44,
  },
  editIconFrame: {
    borderWidth: 1.5,
    height: 22,
    justifyContent: "center",
    paddingHorizontal: 4,
    width: 20,
  },
  editIconLine: {
    height: 1.5,
    marginBottom: 5,
    width: 9,
  },
  editIconLineShort: {
    height: 1.5,
    width: 6,
  },
  editIconCaret: {
    height: 14,
    position: "absolute",
    right: 4,
    top: 4,
    transform: [{ rotate: "28deg" }],
    width: 2,
  },
  previewIconFrame: {
    gap: 5,
    width: 22,
  },
  previewIconLine: {
    height: 2,
    width: 22,
  },
  previewIconRule: {
    height: 2,
    width: 13,
  },
  closeIcon: {
    height: 14,
    justifyContent: "center",
    width: 14,
  },
  closeIconLine: {
    height: 1,
    position: "absolute",
    width: 14,
  },
});
