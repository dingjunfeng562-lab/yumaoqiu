'use client';

import { useEffect, useRef } from 'react';
import { message } from 'antd';

// 公告富文本编辑器（仿 timidc.cn 公告后台）。
// 不依赖已废弃的 document.execCommand：selectionchange 实时保存选区，
// 工具栏 mousedown 阻止默认行为防止编辑器失焦，命令执行时把选中文字
// 包进带 style 的 span。产出的 HTML 直接存库，前台经白名单过滤后渲染。

const COLOR_PRESETS = [
  { value: '#e8442a', title: '红色' },
  { value: '#1d5cd6', title: '蓝色' },
  { value: '#e91ec4', title: '粉色' },
  { value: '#16a34a', title: '绿色' },
  { value: '#f59e0b', title: '橙色' },
  { value: '#1c2330', title: '黑色' },
];

const CSS_MAP: Record<string, Partial<CSSStyleDeclaration>> = {
  bold: { fontWeight: 'bold' },
  underline: { textDecoration: 'underline' },
  big: { fontSize: '22px' },
  normal: { fontSize: '16px' },
};

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'UL', 'OL']);

type RichTextEditorProps = {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
};

export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);

  // 外部值变化时同步进编辑器；编辑中（值相同）不动 DOM，避免光标跳走。
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && (value ?? '') !== editor.innerHTML) {
      editor.innerHTML = value ?? '';
    }
  }, [value]);

  // 实时记录编辑器内的选区：点工具栏（尤其是取色器）会抢焦点，
  // 命令执行前用这里保存的选区恢复。
  useEffect(() => {
    function handleSelectionChange() {
      const editor = editorRef.current;
      const sel = window.getSelection();
      if (editor && sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
        savedRangeRef.current = sel.getRangeAt(0).cloneRange();
      }
    }
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  function emitChange() {
    onChange?.(editorRef.current?.innerHTML ?? '');
  }

  function restoreRange() {
    const range = savedRangeRef.current;
    if (!range) return null;
    const sel = window.getSelection();
    if (!sel) return null;
    sel.removeAllRanges();
    sel.addRange(range);
    return range;
  }

  function reselect(node: Node) {
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(node);
    sel.addRange(range);
    savedRangeRef.current = range.cloneRange();
  }

  function closestBlock(node: Node, editor: HTMLElement) {
    let current = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
    while (current && current !== editor) {
      if (BLOCK_TAGS.has(current.tagName)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function blocksInRange(range: Range, editor: HTMLElement) {
    const blocks = new Set<HTMLElement>();
    const startBlock = closestBlock(range.startContainer, editor);
    const endBlock = closestBlock(range.endContainer, editor);
    if (startBlock) blocks.add(startBlock);
    if (endBlock) blocks.add(endBlock);

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (!(node instanceof HTMLElement) || !BLOCK_TAGS.has(node.tagName)) {
          return NodeFilter.FILTER_SKIP;
        }
        return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });

    let current = walker.nextNode();
    while (current) {
      blocks.add(current as HTMLElement);
      current = walker.nextNode();
    }

    return blocks;
  }

  function applyAlignment(alignment: 'center') {
    const editor = editorRef.current;
    const range = restoreRange();
    if (!editor || !range) {
      message.info('请先选中要居中的文字，或把光标放在段落中');
      return;
    }

    const blocks = blocksInRange(range, editor);
    if (blocks.size > 0) {
      blocks.forEach((block) => {
        block.style.textAlign = alignment;
      });
      savedRangeRef.current = range.cloneRange();
      emitChange();
      return;
    }

    if (range.collapsed) {
      message.info('请先选中要居中的文字，或把光标放在段落中');
      return;
    }

    const block = document.createElement('div');
    block.style.textAlign = alignment;
    block.appendChild(range.extractContents());
    range.insertNode(block);
    reselect(block);
    emitChange();
  }

  function applyCommand(css: Partial<CSSStyleDeclaration> | 'removeFormat') {
    const range = restoreRange();
    if (!range || range.collapsed) {
      message.info('请先选中要设置样式的文字，再点按钮');
      return;
    }

    if (css === 'removeFormat') {
      const textNode = document.createTextNode(range.toString());
      range.deleteContents();
      range.insertNode(textNode);
      reselect(textNode);
      emitChange();
      return;
    }

    const span = document.createElement('span');
    Object.assign(span.style, css);
    try {
      // 选区在同一文本段内：直接包裹
      range.surroundContents(span);
    } catch {
      // 跨标签选区：取出内容再包回去
      span.appendChild(range.extractContents());
      range.insertNode(span);
    }
    reselect(span);
    emitChange();
  }

  // 工具栏按下时不抢走编辑器焦点（否则选区丢失，样式不生效）
  function keepSelection(event: React.MouseEvent) {
    event.preventDefault();
  }

  return (
    <div className="rich-text-editor">
      <div className="rich-text-editor__toolbar">
        <button type="button" onMouseDown={keepSelection} onClick={() => applyCommand(CSS_MAP.bold)}>
          <b>加粗</b>
        </button>
        <button type="button" onMouseDown={keepSelection} onClick={() => applyCommand(CSS_MAP.underline)}>
          <u>下划线</u>
        </button>
        <button type="button" onMouseDown={keepSelection} onClick={() => applyCommand(CSS_MAP.big)}>
          大号字
        </button>
        <button type="button" onMouseDown={keepSelection} onClick={() => applyCommand(CSS_MAP.normal)}>
          正常字
        </button>
        <button type="button" onMouseDown={keepSelection} onClick={() => applyAlignment('center')}>
          居中
        </button>
        {COLOR_PRESETS.map((color) => (
          <button
            key={color.value}
            type="button"
            className="rich-text-editor__color-dot"
            style={{ background: color.value }}
            title={color.title}
            aria-label={color.title}
            onMouseDown={keepSelection}
            onClick={() => applyCommand({ color: color.value })}
          />
        ))}
        {/* 取色器不能 preventDefault（否则打不开），靠 savedRange 恢复选区 */}
        <input
          type="color"
          className="rich-text-editor__color-picker"
          title="自定义颜色"
          onChange={(event) => applyCommand({ color: event.target.value })}
        />
        <button type="button" onMouseDown={keepSelection} onClick={() => applyCommand('removeFormat')}>
          清除格式
        </button>
      </div>
      <div
        ref={editorRef}
        className="rich-text-editor__area"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder ?? '请输入公告内容，选中文字后可用上方按钮设置颜色、加粗、居中等样式'}
        onInput={emitChange}
        onBlur={emitChange}
      />
      <p className="rich-text-editor__tip">先选中文字，再点上方按钮设置样式；居中也可在段落内放置光标后使用。内容将按所见样式展示在前台弹窗中。</p>
    </div>
  );
}
