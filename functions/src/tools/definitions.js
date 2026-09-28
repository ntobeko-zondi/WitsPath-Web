'use strict';

const { LANGUAGE_CODES } = require('../language/languages');

// Tool contracts from the implementation brief (section 5), plus one internal
// tool, declare_language, which lets the server know the reply language so it
// can pick Tier 2 phrase templates and flag lower-confidence languages.
const TOOLS = [
  {
    name: 'find_place',
    description:
      'Look up a place on the Wits campus map by name or description. Returns only confident matches; ' +
      'an empty list means no confident match - ask the user to clarify, never guess a place.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Place name or short description, e.g. "maths building".' },
        accessible_only: {
          type: 'boolean',
          description: 'Exclude places whose entrance is known to be inaccessible.'
        }
      },
      required: ['query', 'accessible_only']
    }
  },
  {
    name: 'get_route',
    description:
      'Get a route between two places using node ids from find_place. This is the only source of routes and ' +
      'distances. If it returns an error, tell the user you cannot confirm a route right now.',
    input_schema: {
      type: 'object',
      properties: {
        from_node_id: { type: 'string' },
        to_node_id: { type: 'string' },
        accessible: { type: 'boolean', description: 'Require a step-free route.' }
      },
      required: ['from_node_id', 'to_node_id', 'accessible']
    }
  },
  {
    name: 'get_travel_time',
    description:
      'Estimate travel time for a distance returned by get_route. Only accepts distances that came from ' +
      'get_route. The result is always an estimate and must be described as one.',
    input_schema: {
      type: 'object',
      properties: {
        distance_m: { type: 'number' },
        mobility_profile: { type: 'string', enum: ['wheelchair', 'ambulatory'] }
      },
      required: ['distance_m']
    }
  },
  {
    name: 'check_path_status',
    description: 'Check live reports of blocked paths or broken lifts at the given node ids.',
    input_schema: {
      type: 'object',
      properties: {
        node_ids: { type: 'array', items: { type: 'string' }, maxItems: 30 }
      },
      required: ['node_ids']
    }
  },
  {
    name: 'report_issue',
    description:
      'File a report about a blocked path, broken lift or wrong label. Only call after the user has confirmed ' +
      'the location and the description you will submit.',
    input_schema: {
      type: 'object',
      properties: {
        node_or_edge_id: { type: 'string', description: 'A node id from find_place or a path node/edge id.' },
        description: { type: 'string' },
        // Optional extension of the brief's contract: the Android app's issue types.
        issue_type: {
          type: 'string',
          enum: ['broken_lift', 'blocked_or_broken_ramp', 'path_obstructed', 'other'],
          description: 'Kind of problem; use "other" if unsure.'
        }
      },
      required: ['node_or_edge_id', 'description']
    }
  },
  {
    name: 'declare_language',
    description:
      'Declare the language you are replying in. Call this once at the start of every turn, alongside any ' +
      'other tool calls. Use "other" for a language not in the list.',
    input_schema: {
      type: 'object',
      properties: {
        lang: { type: 'string', enum: [...LANGUAGE_CODES, 'other'] }
      },
      required: ['lang']
    }
  }
];

module.exports = { TOOLS };
