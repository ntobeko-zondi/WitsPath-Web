package com.example.witspath.routing.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal JSON reader/writer for the routing service, so it needs nothing
 * beyond the JDK. Objects become LinkedHashMap, arrays ArrayList, numbers
 * Double. Strict: trailing garbage and malformed input are rejected.
 */
final class Json
{
    private final String text;
    private int pos;

    private Json(String text)
    {
        this.text = text;
    }

    static Object parse(String text)
    {
        Json parser = new Json(text);
        parser.skipWhitespace();
        Object value = parser.readValue(0);
        parser.skipWhitespace();
        if (parser.pos != text.length())
        {
            throw parser.error("Unexpected trailing characters");
        }
        return value;
    }

    private static final int MAX_DEPTH = 64;

    private Object readValue(int depth)
    {
        if (depth > MAX_DEPTH)
        {
            throw error("Nesting too deep");
        }
        if (pos >= text.length())
        {
            throw error("Unexpected end of input");
        }
        char c = text.charAt(pos);
        switch (c)
        {
            case '{':
                return readObject(depth);
            case '[':
                return readArray(depth);
            case '"':
                return readString();
            case 't':
                expect("true");
                return Boolean.TRUE;
            case 'f':
                expect("false");
                return Boolean.FALSE;
            case 'n':
                expect("null");
                return null;
            default:
                if (c == '-' || (c >= '0' && c <= '9'))
                {
                    return readNumber();
                }
                throw error("Unexpected character '" + c + "'");
        }
    }

    private Map<String, Object> readObject(int depth)
    {
        Map<String, Object> result = new LinkedHashMap<>();
        pos++; // {
        skipWhitespace();
        if (peek() == '}')
        {
            pos++;
            return result;
        }
        while (true)
        {
            skipWhitespace();
            if (peek() != '"')
            {
                throw error("Expected a string key");
            }
            String key = readString();
            skipWhitespace();
            if (peek() != ':')
            {
                throw error("Expected ':'");
            }
            pos++;
            skipWhitespace();
            result.put(key, readValue(depth + 1));
            skipWhitespace();
            char c = peek();
            pos++;
            if (c == '}')
            {
                return result;
            }
            if (c != ',')
            {
                throw error("Expected ',' or '}'");
            }
        }
    }

    private List<Object> readArray(int depth)
    {
        List<Object> result = new ArrayList<>();
        pos++; // [
        skipWhitespace();
        if (peek() == ']')
        {
            pos++;
            return result;
        }
        while (true)
        {
            skipWhitespace();
            result.add(readValue(depth + 1));
            skipWhitespace();
            char c = peek();
            pos++;
            if (c == ']')
            {
                return result;
            }
            if (c != ',')
            {
                throw error("Expected ',' or ']'");
            }
        }
    }

    private String readString()
    {
        StringBuilder sb = new StringBuilder();
        pos++; // opening quote
        while (true)
        {
            if (pos >= text.length())
            {
                throw error("Unterminated string");
            }
            char c = text.charAt(pos++);
            if (c == '"')
            {
                return sb.toString();
            }
            if (c < 0x20)
            {
                throw error("Control character in string");
            }
            if (c != '\\')
            {
                sb.append(c);
                continue;
            }
            if (pos >= text.length())
            {
                throw error("Unterminated escape");
            }
            char e = text.charAt(pos++);
            switch (e)
            {
                case '"': sb.append('"'); break;
                case '\\': sb.append('\\'); break;
                case '/': sb.append('/'); break;
                case 'b': sb.append('\b'); break;
                case 'f': sb.append('\f'); break;
                case 'n': sb.append('\n'); break;
                case 'r': sb.append('\r'); break;
                case 't': sb.append('\t'); break;
                case 'u':
                    if (pos + 4 > text.length())
                    {
                        throw error("Bad unicode escape");
                    }
                    try
                    {
                        sb.append((char) Integer.parseInt(text.substring(pos, pos + 4), 16));
                    }
                    catch (NumberFormatException ex)
                    {
                        throw error("Bad unicode escape");
                    }
                    pos += 4;
                    break;
                default:
                    throw error("Bad escape");
            }
        }
    }

    private Double readNumber()
    {
        int start = pos;
        if (peek() == '-')
        {
            pos++;
        }
        while (pos < text.length() && "0123456789.eE+-".indexOf(text.charAt(pos)) >= 0)
        {
            pos++;
        }
        try
        {
            return Double.valueOf(text.substring(start, pos));
        }
        catch (NumberFormatException ex)
        {
            throw error("Bad number");
        }
    }

    private void expect(String word)
    {
        if (!text.startsWith(word, pos))
        {
            throw error("Expected " + word);
        }
        pos += word.length();
    }

    private char peek()
    {
        if (pos >= text.length())
        {
            throw error("Unexpected end of input");
        }
        return text.charAt(pos);
    }

    private void skipWhitespace()
    {
        while (pos < text.length() && Character.isWhitespace(text.charAt(pos)))
        {
            pos++;
        }
    }

    private IllegalArgumentException error(String message)
    {
        return new IllegalArgumentException("Invalid JSON at " + pos + ": " + message);
    }

    // ---- writer ------------------------------------------------------------

    static String write(Object value)
    {
        StringBuilder sb = new StringBuilder();
        writeValue(sb, value);
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private static void writeValue(StringBuilder sb, Object value)
    {
        if (value == null)
        {
            sb.append("null");
        }
        else if (value instanceof String)
        {
            writeString(sb, (String) value);
        }
        else if (value instanceof Number)
        {
            double d = ((Number) value).doubleValue();
            if (!Double.isFinite(d))
            {
                sb.append("null");
            }
            else if (d == Math.rint(d) && Math.abs(d) < 1e15)
            {
                sb.append((long) d);
            }
            else
            {
                sb.append(d);
            }
        }
        else if (value instanceof Boolean)
        {
            sb.append(value.toString());
        }
        else if (value instanceof Map)
        {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<String, Object> entry : ((Map<String, Object>) value).entrySet())
            {
                if (!first)
                {
                    sb.append(',');
                }
                first = false;
                writeString(sb, entry.getKey());
                sb.append(':');
                writeValue(sb, entry.getValue());
            }
            sb.append('}');
        }
        else if (value instanceof List)
        {
            sb.append('[');
            boolean first = true;
            for (Object item : (List<Object>) value)
            {
                if (!first)
                {
                    sb.append(',');
                }
                first = false;
                writeValue(sb, item);
            }
            sb.append(']');
        }
        else
        {
            throw new IllegalArgumentException("Cannot serialise " + value.getClass());
        }
    }

    private static void writeString(StringBuilder sb, String s)
    {
        sb.append('"');
        for (int i = 0; i < s.length(); i++)
        {
            char c = s.charAt(i);
            switch (c)
            {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20)
                    {
                        sb.append(String.format("\\u%04x", (int) c));
                    }
                    else
                    {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
    }
}
