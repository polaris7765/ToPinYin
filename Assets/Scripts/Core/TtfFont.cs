using System;
using System.Collections.Generic;
using System.IO;

namespace PinyinApp.Core
{
    /// <summary>子集化后的字体数据与映射。</summary>
    public class FontSubset
    {
        public byte[] FontBytes;                 // 子集 TTF
        public Dictionary<uint, ushort> UnicodeToNewGid; // 用到的 Unicode -> 新 GID(CID)
        public Dictionary<ushort, ushort> OldToNew;      // 旧 GID -> 新 GID
        public int NewNumGlyphs;
    }

    /// <summary>
    /// TrueType 字体解析器：读取 cmap / hmtx / head / hhea / maxp / loca / glyf 等表，
    /// 并支持生成静态子集字体（供 PDF 内嵌）。
    /// 纯 C#，不依赖 UnityEngine。
    /// </summary>
    public class TtfFont
    {
        public float UnitsPerEm = 1000f;
        public int NumGlyphs;
        public int IndexToLocFormat;
        public short XMin, YMin, XMax, YMax;
        public short Ascent, Descent, LineGap;

        private byte[] _data;
        private Dictionary<uint, ushort> _cmap;
        private ushort[] _advanceWidth;
        private short[] _lsb;
        private uint[] _loca;
        private byte[] _glyf;
        private Dictionary<string, long> _tableOffset = new Dictionary<string, long>();
        private Dictionary<string, long> _tableLength = new Dictionary<string, long>();

        // ---------------- 二进制读取 ----------------

        private static ushort BE16(byte[] d, long o)
        {
            return (ushort)((d[o] << 8) | d[o + 1]);
        }

        private static int BE16S(byte[] d, long o)
        {
            return (short)((d[o] << 8) | d[o + 1]);
        }

        private static uint BE32(byte[] d, long o)
        {
            return (uint)((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]);
        }

        // ---------------- 解析 ----------------

        public bool Parse(byte[] data)
        {
            if (data == null || data.Length < 12) return false;
            _data = data;

            int numTables = BE16(data, 4);
            Dictionary<string, long> off = new Dictionary<string, long>();
            Dictionary<string, long> len = new Dictionary<string, long>();
            for (int i = 0; i < numTables; i++)
            {
                long rec = 12 + i * 16L;
                if (rec + 16 > data.Length) return false;
                string tag = "" + (char)data[rec] + (char)data[rec + 1] + (char)data[rec + 2] + (char)data[rec + 3];
                long offset = BE32(data, rec + 8);
                long length = BE32(data, rec + 12);
                off[tag] = offset;
                len[tag] = length;
            }
            _tableOffset = off;
            _tableLength = len;

            // head
            if (!off.ContainsKey("head")) return false;
            long head = off["head"];
            if (head + 54 > data.Length) return false;
            UnitsPerEm = BE16(data, head + 18);
            XMin = (short)BE16S(data, head + 36);
            YMin = (short)BE16S(data, head + 38);
            XMax = (short)BE16S(data, head + 40);
            YMax = (short)BE16S(data, head + 42);
            IndexToLocFormat = BE16S(data, head + 50);

            // maxp
            if (!off.ContainsKey("maxp")) return false;
            NumGlyphs = BE16(data, off["maxp"] + 4);

            // hhea
            if (!off.ContainsKey("hhea")) return false;
            long hhea = off["hhea"];
            Ascent = (short)BE16S(data, hhea + 4);
            Descent = (short)BE16S(data, hhea + 6);
            LineGap = (short)BE16S(data, hhea + 8);
            int numberOfHMetrics = BE16(data, hhea + 34);

            // hmtx
            if (!off.ContainsKey("hmtx")) return false;
            long hmtx = off["hmtx"];
            _advanceWidth = new ushort[NumGlyphs];
            _lsb = new short[NumGlyphs];
            long p = hmtx;
            ushort lastAdvance = 0;
            for (int i = 0; i < NumGlyphs; i++)
            {
                if (i < numberOfHMetrics && p + 4 <= data.Length)
                {
                    lastAdvance = BE16(data, p);
                    _advanceWidth[i] = lastAdvance;
                    _lsb[i] = (short)BE16S(data, p + 2);
                    p += 4;
                }
                else if (p + 2 <= data.Length)
                {
                    _advanceWidth[i] = lastAdvance;
                    _lsb[i] = (short)BE16S(data, p);
                    p += 2;
                }
                else
                {
                    _advanceWidth[i] = lastAdvance;
                    _lsb[i] = 0;
                }
            }

            // cmap
            if (!off.ContainsKey("cmap")) return false;
            if (!ParseCmap(off["cmap"], len["cmap"])) return false;

            // loca / glyf
            if (!off.ContainsKey("loca") || !off.ContainsKey("glyf")) return false;
            long locaOff = off["loca"];
            long locaLen = len["loca"];
            _loca = new uint[NumGlyphs + 1];
            if (IndexToLocFormat == 0)
            {
                for (int i = 0; i <= NumGlyphs; i++)
                {
                    if (locaOff + i * 2L + 2 > data.Length) return false;
                    _loca[i] = (uint)(BE16(data, locaOff + i * 2L) * 2);
                }
            }
            else
            {
                for (int i = 0; i <= NumGlyphs; i++)
                {
                    if (locaOff + i * 4L + 4 > data.Length) return false;
                    _loca[i] = BE32(data, locaOff + i * 4L);
                }
            }
            _glyf = new byte[len["glyf"]];
            Array.Copy(data, off["glyf"], _glyf, 0, len["glyf"]);

            return true;
        }

        private bool ParseCmap(long cmapOff, long cmapLen)
        {
            byte[] d = _data;
            int numTables = BE16(d, cmapOff + 2);
            long best = -1;
            int bestScore = -1;
            for (int i = 0; i < numTables; i++)
            {
                long rec = cmapOff + 4 + i * 8L;
                if (rec + 8 > d.Length) continue;
                int platform = BE16(d, rec);
                int encoding = BE16(d, rec + 2);
                long subOff = cmapOff + BE32(d, rec + 4);
                int score = Score(platform, encoding);
                if (score > bestScore)
                {
                    bestScore = score;
                    best = subOff;
                }
            }
            if (best < 0) return false;
            if (best + 2 > cmapOff + cmapLen || best + 2 > _data.Length) return false;
            return ReadSubtable(best, cmapLen);
        }

        private static int Score(int platform, int encoding)
        {
            if (platform == 3 && encoding == 1) return 100;  // Windows Unicode BMP
            if (platform == 0 && encoding == 4) return 90;   // Unicode 2.0 full
            if (platform == 3 && encoding == 10) return 80;  // Windows full repertoire
            if (platform == 0 && encoding == 3) return 70;   // Unicode 2.0 BMP
            if (platform == 0 && encoding == 6) return 60;   // Unicode 2.0 full (deprecated)
            if (platform == 0 && encoding == 0) return 50;   // Unicode 1.0
            return -1;
        }

        private bool ReadSubtable(long off, long cmapLen)
        {
            byte[] d = _data;
            int format = BE16(d, off);
            _cmap = new Dictionary<uint, ushort>();
            if (format == 4)
            {
                int segCountX2 = BE16(d, off + 6);
                int segCount = segCountX2 / 2;
                long endBase = off + 14;
                long startBase = endBase + segCountX2 + 2;
                long deltaBase = startBase + segCountX2;
                long rangeBase = deltaBase + segCountX2;
                long glyphBase = rangeBase + segCountX2;
                for (int s = 0; s < segCount; s++)
                {
                    ushort endCode = BE16(d, endBase + s * 2L);
                    ushort startCode = BE16(d, startBase + s * 2L);
                    short idDelta = (short)BE16S(d, deltaBase + s * 2L);
                    ushort idRangeOffset = BE16(d, rangeBase + s * 2L);
                    for (uint c = startCode; c <= endCode; c++)
                    {
                        ushort gid;
                        if (idRangeOffset == 0)
                        {
                            gid = (ushort)((c + (ushort)idDelta) & 0xFFFF);
                        }
                        else
                        {
                            long gp = rangeBase + s * 2L + idRangeOffset + (c - startCode) * 2L;
                            if (gp + 2 > d.Length) continue;
                            ushort g = BE16(d, gp);
                            gid = g == 0 ? (ushort)0 : (ushort)((g + (ushort)idDelta) & 0xFFFF);
                        }
                        if (gid != 0) _cmap[c] = gid;
                    }
                }
                return true;
            }
            else if (format == 12)
            {
                uint nGroups = BE32(d, off + 12);
                long basePos = off + 16;
                for (uint i = 0; i < nGroups; i++)
                {
                    long p = basePos + i * 12L;
                    uint start = BE32(d, p);
                    uint end = BE32(d, p + 4);
                    uint startGid = BE32(d, p + 8);
                    for (uint c = start; c <= end; c++)
                    {
                        ushort gid = (ushort)(startGid + (c - start));
                        if (gid != 0) _cmap[c] = gid;
                    }
                }
                return true;
            }
            else if (format == 6)
            {
                ushort firstCode = BE16(d, off + 6);
                ushort entryCount = BE16(d, off + 8);
                for (int i = 0; i < entryCount; i++)
                {
                    ushort gid = BE16(d, off + 10 + i * 2L);
                    if (gid != 0) _cmap[(uint)(firstCode + i)] = gid;
                }
                return true;
            }
            else if (format == 0)
            {
                for (int i = 0; i < 256; i++)
                {
                    byte gid = d[off + 6 + i];
                    if (gid != 0) _cmap[(uint)i] = gid;
                }
                return true;
            }
            return false;
        }

        public bool HasGlyph(uint unicode)
        {
            return _cmap != null && _cmap.ContainsKey(unicode);
        }

        public ushort GetGlyph(uint unicode)
        {
            ushort g;
            if (_cmap != null && _cmap.TryGetValue(unicode, out g)) return g;
            return 0;
        }

        public float GetAdvance(int gid)
        {
            if (gid < 0 || gid >= _advanceWidth.Length) return 0;
            return _advanceWidth[gid];
        }

        public short GetLsb(int gid)
        {
            if (gid < 0 || gid >= _lsb.Length) return 0;
            return _lsb[gid];
        }

        // ---------------- 复合字形解析 ----------------

        private struct ComponentRef
        {
            public long FieldPos;   // gid 字段在 glyf 表中的位置
            public ushort OldGid;
        }

        private List<ComponentRef> ParseComponents(long start, long end, out bool isComposite)
        {
            isComposite = false;
            if (end - start < 10) return null;
            int numContours = BE16S(_glyf, start);
            if (numContours >= 0) return null;   // 简单字形

            isComposite = true;
            List<ComponentRef> list = new List<ComponentRef>();
            long pos = start + 10;
            bool more = true;
            while (more && pos + 4 <= end)
            {
                ushort flags = BE16(_glyf, pos);
                ushort gid = BE16(_glyf, pos + 2);
                list.Add(new ComponentRef { FieldPos = pos + 2, OldGid = gid });
                pos += 4;
                pos += (flags & 0x0001) != 0 ? 4 : 2;            // 参数
                if ((flags & 0x0008) != 0) pos += 2;             // scale
                else if ((flags & 0x0040) != 0) pos += 4;        // xy scale
                else if ((flags & 0x0080) != 0) pos += 8;        // 2x2
                more = (flags & 0x0020) != 0;                    // MORE_COMPONENTS
            }
            return list;
        }

        // ---------------- 子集化 ----------------

        /// <summary>
        /// 基于用到的 Unicode 字符生成静态子集字体（去掉 fvar/gvar，保留 glyf 默认外形）。
        /// </summary>
        public FontSubset BuildSubset(IEnumerable<uint> unicodeChars)
        {
            // 1. 收集用到的旧 GID
            SortedSet<ushort> used = new SortedSet<ushort>();
            HashSet<uint> usedUnicode = new HashSet<uint>();
            foreach (uint u in unicodeChars)
            {
                ushort g = GetGlyph(u);
                if (g > 0)
                {
                    used.Add(g);
                    usedUnicode.Add(u);
                }
            }
            used.Add(0);   // .notdef 始终保留

            // 2. 展开复合字形引用的组件
            bool changed = true;
            int guard = 0;
            while (changed && guard++ < 50)
            {
                changed = false;
                ushort[] snapshot = new List<ushort>(used).ToArray();
                foreach (ushort gid in snapshot)
                {
                    long start = _loca[gid];
                    long end = _loca[gid + 1];
                    if (end <= start) continue;
                    bool isComp;
                    List<ComponentRef> comps = ParseComponents(start, end, out isComp);
                    if (comps != null)
                    {
                        foreach (ComponentRef cr in comps)
                        {
                            if (used.Add(cr.OldGid)) changed = true;
                        }
                    }
                }
            }

            // 3. 旧->新映射（按旧 GID 升序）
            Dictionary<ushort, ushort> oldToNew = new Dictionary<ushort, ushort>();
            ushort next = 0;
            foreach (ushort old in used) oldToNew[old] = next++;
            int newNum = next;

            // 4. 构建新 glyf / loca
            MemoryStream glyfStream = new MemoryStream();
            uint[] newLoca = new uint[newNum + 1];
            ushort[] oldList = new List<ushort>(used).ToArray();
            for (int i = 0; i < oldList.Length; i++)
            {
                ushort old = oldList[i];
                newLoca[i] = (uint)glyfStream.Length;
                long start = _loca[old];
                long end = _loca[old + 1];
                long length = end - start;
                if (length <= 0) continue;

                bool isComp;
                List<ComponentRef> comps = ParseComponents(start, end, out isComp);
                byte[] slice = new byte[length];
                Array.Copy(_glyf, start, slice, 0, length);
                if (isComp && comps != null)
                {
                    foreach (ComponentRef cr in comps)
                    {
                        ushort newGid = oldToNew[cr.OldGid];
                        int rel = (int)(cr.FieldPos - start);
                        if (rel + 1 < slice.Length)
                        {
                            slice[rel] = (byte)(newGid >> 8);
                            slice[rel + 1] = (byte)(newGid & 0xFF);
                        }
                    }
                }
                glyfStream.Write(slice, 0, slice.Length);
            }
            newLoca[newNum] = (uint)glyfStream.Length;
            byte[] newGlyf = glyfStream.ToArray();

            // 5. 新 hmtx
            ushort[] newAdvance = new ushort[newNum];
            short[] newLsb = new short[newNum];
            for (int i = 0; i < oldList.Length; i++)
            {
                ushort old = oldList[i];
                newAdvance[i] = (old < _advanceWidth.Length) ? _advanceWidth[old] : (ushort)0;
                newLsb[i] = (old < _lsb.Length) ? _lsb[old] : (short)0;
            }
            MemoryStream hmtxStream = new MemoryStream();
            for (int i = 0; i < newNum; i++)
            {
                hmtxStream.WriteByte((byte)(newAdvance[i] >> 8));
                hmtxStream.WriteByte((byte)(newAdvance[i] & 0xFF));
                hmtxStream.WriteByte((byte)(newLsb[i] >> 8));
                hmtxStream.WriteByte((byte)(newLsb[i] & 0xFF));
            }
            byte[] newHmtx = hmtxStream.ToArray();

            // 6. 新 loca（长格式）
            MemoryStream locaStream = new MemoryStream();
            for (int i = 0; i < newLoca.Length; i++)
            {
                WriteBE32(locaStream, newLoca[i]);
            }
            byte[] newLocaBytes = locaStream.ToArray();

            // 7. 新 cmap（format 4）
            byte[] newCmap = BuildCmapFormat4(usedUnicode, oldToNew);

            // 8. 新 head（indexToLocFormat=1）
            byte[] newHead = CopyTable("head");
            SetBE16(newHead, 50, 1);                    // indexToLocFormat = 1
            SetBE32(newHead, 8, 0);                     // checkSumAdjustment = 0

            // 9. 新 hhea（numberOfHMetrics = newNum）
            byte[] newHhea = CopyTable("hhea");
            SetBE16(newHhea, 34, (ushort)newNum);

            // 10. 新 maxp（numGlyphs）
            byte[] newMaxp = CopyTable("maxp");
            SetBE16(newMaxp, 4, (ushort)newNum);

            // 11. OS/2：更新 usFirstCharIndex / usLastCharIndex
            byte[] newOS2 = null;
            if (_tableOffset.ContainsKey("OS/2") && _tableLength["OS/2"] >= 68)
            {
                newOS2 = CopyTable("OS/2");
                uint minU = 0x10FFFF, maxU = 0;
                foreach (uint u in usedUnicode) { if (u < minU) minU = u; if (u > maxU) maxU = u; }
                SetBE16(newOS2, 64, (ushort)Math.Min(minU, 0xFFFF));
                SetBE16(newOS2, 66, (ushort)Math.Min(maxU, 0xFFFF));
            }

            // 12. post（3.0）
            byte[] newPost = new byte[32];
            WriteBE32(newPost, 0, 0x00030000);
            WriteBE32(newPost, 4, 0);
            WriteBE16(newPost, 8, -100);   // underlinePosition
            WriteBE16(newPost, 10, 50);    // underlineThickness
            // 其余为 0

            // 13. name（最小化）
            byte[] newName = BuildMinName("PinyinSubset");

            // 14. 组装
            Dictionary<string, byte[]> tables = new Dictionary<string, byte[]>();
            tables["cmap"] = newCmap;
            tables["glyf"] = newGlyf;
            tables["head"] = newHead;
            tables["hhea"] = newHhea;
            tables["hmtx"] = newHmtx;
            tables["loca"] = newLocaBytes;
            tables["maxp"] = newMaxp;
            tables["name"] = newName;
            tables["post"] = newPost;
            if (newOS2 != null) tables["OS/2"] = newOS2;

            byte[] fontBytes = AssembleFont(tables);

            FontSubset subset = new FontSubset();
            subset.FontBytes = fontBytes;
            subset.OldToNew = oldToNew;
            subset.NewNumGlyphs = newNum;
            Dictionary<uint, ushort> u2n = new Dictionary<uint, ushort>();
            foreach (uint u in usedUnicode)
            {
                ushort old = GetGlyph(u);
                u2n[u] = oldToNew[old];
            }
            subset.UnicodeToNewGid = u2n;
            return subset;
        }

        // ---------------- 表构建 ----------------

        private byte[] CopyTable(string tag)
        {
            long off = _tableOffset[tag];
            long len = _tableLength[tag];
            byte[] b = new byte[len];
            Array.Copy(_data, off, b, 0, len);
            return b;
        }

        private byte[] BuildCmapFormat4(HashSet<uint> usedUnicode, Dictionary<ushort, ushort> oldToNew)
        {
            List<uint> sorted = new List<uint>(usedUnicode);
            sorted.Sort();

            // 分段：连续的码点且新 GID 连续则合并
            List<uint> starts = new List<uint>();
            List<uint> ends = new List<uint>();
            List<ushort> firstGids = new List<ushort>();
            int i = 0;
            while (i < sorted.Count)
            {
                uint segStart = sorted[i];
                ushort g0 = oldToNew[GetGlyph(segStart)];
                uint segEnd = segStart;
                int j = i + 1;
                while (j < sorted.Count)
                {
                    uint prev = sorted[j - 1];
                    uint cur = sorted[j];
                    ushort gp = oldToNew[GetGlyph(prev)];
                    ushort gc = oldToNew[GetGlyph(cur)];
                    if (cur == prev + 1 && (uint)(gc) == (uint)(gp + 1))
                    {
                        segEnd = cur;
                        j++;
                    }
                    else break;
                }
                starts.Add(segStart);
                ends.Add(segEnd);
                firstGids.Add(g0);
                i = j;
            }

            int segCount = starts.Count;
            MemoryStream ms = new MemoryStream();
            WriteBE16(ms, 4);                                   // format
            WriteBE16(ms, 0);                                   // length（稍后回填）
            WriteBE16(ms, 0);                                   // language
            WriteBE16(ms, (ushort)(segCount * 2));              // segCountX2
            int pow = 1, entrySelector = 0;
            while (pow * 2 <= segCount) { pow *= 2; entrySelector++; }
            WriteBE16(ms, (ushort)(pow * 2));                   // searchRange
            WriteBE16(ms, (ushort)entrySelector);               // entrySelector
            WriteBE16(ms, (ushort)(segCount * 2 - pow * 2));    // rangeShift

            for (int s = 0; s < segCount; s++) WriteBE16(ms, (ushort)ends[s]);
            WriteBE16(ms, 0);                                   // reservedPad
            for (int s = 0; s < segCount; s++) WriteBE16(ms, (ushort)starts[s]);
            for (int s = 0; s < segCount; s++)
            {
                // idDelta = (firstGid - start) mod 65536，按无符号存储
                int delta = (firstGids[s] - (int)starts[s]) & 0xFFFF;
                WriteBE16(ms, (ushort)delta);
            }
            for (int s = 0; s < segCount; s++) WriteBE16(ms, 0);   // idRangeOffset = 0

            byte[] sub = ms.ToArray();
            SetBE16(sub, 2, (ushort)sub.Length);   // 回填 length

            // 组装完整 cmap 表：表头 + 编码记录 + format4 子表
            MemoryStream full = new MemoryStream();
            WriteBE16(full, 0);     // version
            WriteBE16(full, 1);     // numTables
            WriteBE16(full, 3);     // platformID = Windows
            WriteBE16(full, 1);     // encodingID = Unicode BMP
            WriteBE32(full, 12);    // 子表偏移
            full.Write(sub, 0, sub.Length);
            return full.ToArray();
        }

        private byte[] BuildMinName(string family)
        {
            byte[] str = System.Text.Encoding.UTF8.GetBytes(family);
            int count = 1;
            int stringOffset = 6 + 12 * count;
            MemoryStream ms = new MemoryStream();
            WriteBE16(ms, 0);                    // format
            WriteBE16(ms, (ushort)count);
            WriteBE16(ms, (ushort)stringOffset);
            // name record: platformID=3, encodingID=1, languageID=0x0409, nameID=1
            WriteBE16(ms, 3);
            WriteBE16(ms, 1);
            WriteBE16(ms, 0x0409);
            WriteBE16(ms, 1);
            WriteBE16(ms, (ushort)str.Length);
            WriteBE16(ms, 0);
            ms.Write(str, 0, str.Length);
            return ms.ToArray();
        }

        private static void WriteBE16(MemoryStream ms, ushort v)
        {
            ms.WriteByte((byte)(v >> 8));
            ms.WriteByte((byte)(v & 0xFF));
        }

        private static void WriteBE16(byte[] arr, int off, int v)
        {
            arr[off] = (byte)(v >> 8);
            arr[off + 1] = (byte)(v & 0xFF);
        }

        private static void WriteBE32(MemoryStream ms, uint v)
        {
            ms.WriteByte((byte)(v >> 24));
            ms.WriteByte((byte)((v >> 16) & 0xFF));
            ms.WriteByte((byte)((v >> 8) & 0xFF));
            ms.WriteByte((byte)(v & 0xFF));
        }

        private static void WriteBE32(byte[] arr, int off, uint v)
        {
            arr[off] = (byte)(v >> 24);
            arr[off + 1] = (byte)((v >> 16) & 0xFF);
            arr[off + 2] = (byte)((v >> 8) & 0xFF);
            arr[off + 3] = (byte)(v & 0xFF);
        }

        private static void SetBE16(byte[] arr, int off, ushort v)
        {
            arr[off] = (byte)(v >> 8);
            arr[off + 1] = (byte)(v & 0xFF);
        }

        private static void SetBE32(byte[] arr, int off, uint v)
        {
            arr[off] = (byte)(v >> 24);
            arr[off + 1] = (byte)((v >> 16) & 0xFF);
            arr[off + 2] = (byte)((v >> 8) & 0xFF);
            arr[off + 3] = (byte)(v & 0xFF);
        }

        private static uint Checksum(byte[] data, int start, int length)
        {
            uint sum = 0;
            int end = start + length;
            int i = start;
            for (; i + 3 < end; i += 4)
            {
                sum += (uint)((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]);
            }
            int rem = end - i;
            if (rem > 0)
            {
                uint v = 0;
                for (int k = 0; k < rem; k++) v |= (uint)(data[i + k] << (24 - 8 * k));
                sum += v;
            }
            return sum;
        }

        private byte[] AssembleFont(Dictionary<string, byte[]> tables)
        {
            List<string> tags = new List<string>(tables.Keys);
            tags.Sort();
            int n = tags.Count;

            // 计算总大小（4 字节对齐）
            int headerSize = 12 + 16 * n;
            long total = headerSize;
            List<long> tableOffsets = new List<long>();
            foreach (string t in tags)
            {
                total = Align4(total);
                tableOffsets.Add(total);
                total += tables[t].Length;
            }
            total = Align4(total);
            byte[] font = new byte[total];

            // sfnt 头
            WriteBE32(font, 0, 0x00010000);   // version 1.0
            WriteBE16(font, 4, (ushort)n);
            int pow = 1, entrySelector = 0;
            while (pow * 2 <= n) { pow *= 2; entrySelector++; }
            WriteBE16(font, 6, (ushort)(pow * 16));               // searchRange
            WriteBE16(font, 8, (ushort)entrySelector);
            WriteBE16(font, 10, (ushort)(n * 16 - pow * 16));     // rangeShift

            for (int i = 0; i < n; i++)
            {
                string tag = tags[i];
                byte[] tdata = tables[tag];
                long off = tableOffsets[i];
                int rec = 12 + i * 16;
                font[rec] = (byte)tag[0];
                font[rec + 1] = (byte)tag[1];
                font[rec + 2] = (byte)tag[2];
                font[rec + 3] = (byte)tag[3];
                // checksum 先占位
                WriteBE32(font, rec + 8, (uint)off);
                WriteBE32(font, rec + 12, (uint)tdata.Length);
                Array.Copy(tdata, 0, font, off, tdata.Length);
            }

            // 计算并写入各表 checksum
            uint totalChecksum = Checksum(font, 0, headerSize);
            for (int i = 0; i < n; i++)
            {
                string tag = tags[i];
                long off = tableOffsets[i];
                uint cs = Checksum(font, (int)off, tables[tag].Length);
                int rec = 12 + i * 16;
                WriteBE32(font, rec + 4, cs);
                totalChecksum += cs;
            }

            // head.checkSumAdjustment = 0xB1B0AFBA - totalChecksum
            long headOff = -1;
            for (int i = 0; i < n; i++)
            {
                if (tags[i] == "head") { headOff = tableOffsets[i]; break; }
            }
            if (headOff >= 0)
            {
                uint adj = 0xB1B0AFBAu - totalChecksum;
                WriteBE32(font, (int)headOff + 8, adj);
            }
            return font;
        }

        private static long Align4(long v)
        {
            return (v + 3) & ~3L;
        }
    }
}
