/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Skywriter.
 *
 * The Initial Developer of the Original Code is
 * Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Joe Walker (jwalker@mozilla.com)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

define(function(require, exports, module) {


var console = require('pilot/console');
var lang = require('pilot/lang');
var oop = require('pilot/oop');
var EventEmitter = require('pilot/event_emitter').EventEmitter;

//var keyboard = require('keyboard/keyboard');
var types = require('pilot/types');
var Status = require('pilot/types').Status;
var Conversion = require('pilot/types').Conversion;
var canon = require('pilot/canon');

/**
 * Normally type upgrade is done when the owning command is registered, but
 * out commandParam isn't part of a command, so it misses out.
 */
exports.startup = function(data, reason) {
    canon.upgradeType('command', commandParam);
};

/**
 * The information required to tell the user there is a problem with their
 * input.
 * @param status VALID,INCOMPLETE or ERROR from pilot/types:Status
 * @param message Message to report to the user
 * @param start The start position of the message in the input string
 * @param end See start
 * @param predictions Array of ways in which the input could be completed
 */
function Hint(status, message, paramIndex, start, end, predictions) {
    // For manual setup
    if (status === undefined) {
        this.status = Status.VALID;
        this.message = '';
        this.start = Argument.AT_CURSOR;
        this.end = Argument.AT_CURSOR;
        this.predictions = [];
        this.paramIndex = -1;
        return;
    }

    this.status = status;
    this.message = message;
    this.paramIndex = paramIndex;

    if (typeof start === 'number') {
        this.start = start;
        this.end = end;
        this.predictions = predictions;
    }
    else {
        var arg = start;
        this.start = arg.start;
        this.end = arg.end;
        this.predictions = arg.predictions;
    }
}
Hint.prototype = {
};
/**
 * Loop over the array of hints finding the one we should display.
 * @param hints array of hints
 */
Hint.sort = function(hints, order, cursor) {
    // TODO: If we don't need this soon, rip it out, also the current default
    // ordering makes distance irrelevant, maybe this can be removed too
    if (order !== Hint.sort.Order.STATUS_PARAM_DISTANCE) {
        throw new Error('alternate sort order not supported yet');
    }
    // Calculate 'distance from cursor'
    if (cursor !== undefined) {
        hints.forEach(function(hint) {
            if (hint.start === Argument.AT_CURSOR) {
                hint.distance = 0;
            }
            else if (cursor < hint.start) {
                hint.distance = hint.start - cursor;
            }
            else if (cursor > hint.end) {
                hint.distance = cursor - hint.end;
            }
            else {
                hint.distance = 0;
            }
        }, this);
    }
    // Sort
    hints.sort(function(hint1, hint2) {
        // Compare based on hint severity
        if (hint2.status !== hint1.status) {
            return hint2.status - hint1.status;
        }
        // Compare based on paramIndex (lowest wins)
        if (hint1.paramIndex >= 0 && hint2.paramIndex >= 0 &&
                hint1.paramIndex !== hint2.paramIndex) {
            return hint2.paramIndex - hint1.paramIndex;
        }
        // Compare based on distance from cursor
        if (cursor !== undefined) {
            var diff = hint1.distance - hint2.distance;
            if (diff != 0) {
                return diff;
            }
        }
        // Should we default to alphabetical order, or something else?
        return 0;
    });
    // Tidy-up
    if (cursor !== undefined) {
        hints.forEach(function(hint) {
            delete hint.distance;
        }, this);
    }
    return hints;
};
Hint.sort.Order = {
    STATUS_PARAM_DISTANCE: 1,
    STATUS_DISTANCE_PARAM: 2,
    PARAM_STATUS_DISTANCE: 3,
    PARAM_DISTANCE_STATUS: 4,
    DISTANCE_STATUS_PARAM: 5,
    DISTANCE_PARAM_STATUS: 6
};
exports.Hint = Hint;


// TODO: Outstanding question - perhaps this belongs in type.js because the
// conversion process seems somewhat dependent on Arguments
/**
 * We record where in the input string an argument comes so we can report errors
 * against those string positions.
 * We publish a 'change' event when-ever the text changes.
 * @param text The string (trimmed) that contains the argument
 * @param start The position of the text in the original input string
 * @param end See start
 * @param prefix Knowledge of quotation marks and whitespace used prior to the
 * text in the input string allows us to re-generate the original input from
 * the arguments.
 * @param suffix Any quotation marks and whitespace used after the text.
 * Whitespace is normally placed in the prefix to the succeeding argument, but
 * can be used here when this is the last argument.
 * @constructor
 */
function Argument(text, start, end, prefix, suffix) {
    if (text == null) {
        throw new Error('Illegal text for Argument: ' + text);
    }

    this.text = text;
    this.start = start;
    this.end = end;
    this.prefix = prefix;
    this.suffix = suffix;
}
Argument.prototype = {
    /**
     * Return the result of merging these arguments.
     * TODO: What happens when we're merging arguments for the single string
     * case and some of the arguments are in quotation marks?
     */
    merge: function(following) {
        return new Argument(
            this.text + this.suffix + following.prefix + following.text,
            this.start, following.end,
            this.prefix,
            following.suffix);
    },

    /**
     * Helper when we're putting arguments back together
     */
    toString: function() {
        // TODO: There is a bug here - we should re-escape escaped characters
        // But can we do that reliably?
        return this.prefix + this.text + this.suffix;
    }
};

/**
 * Merge an array of arguments into a single argument.
 * All Arguments in the array are expected to have the same emitter
 */
Argument.merge = function(argArray, start, end) {
    start = (start === undefined) ? 0 : start;
    end = (end === undefined) ? argArray.length : end;

    var joined;
    for (var i = start; i < end; i++) {
        var arg = argArray[i];
        if (!joined) {
            joined = arg;
        }
        else {
            joined = joined.merge(arg);
        }
    }
    return joined;
};

/**
 * We sometimes need a way to say 'this error occurs where the cursor is',
 * which causes it to be sorted towards the top.
 */
Argument.AT_CURSOR = -1;
exports.Argument = Argument;

/**
 * A link between a parameter and the data for that parameter.
 * The data for the parameter is available as in the preferred type and as
 * an Argument for the CLI.
 * <p>We also record validity information where applicable.
 * <p>For values, null and undefined have distinct definitions. null means
 * that a value has been provided, undefined means that it has not.
 * Thus, null is a valid default value, and common because it identifies an
 * parameter that is optional. undefined means there is no value from
 * the command line.
 *
 * <h2>Events<h2>
 * Assignment publishes the following event:<ul>
 * <li>assignmentChange: Either the value or the text has changed. It is likely
 * that any UI component displaying this argument will need to be updated.
 * The event object looks like: { assignment: X }
 * @constructor
 */
function Assignment(param, paramIndex) {
    this.param = param;
    this.paramIndex = paramIndex;

    this.conversion = this.param.getDefault ?
            this.param.getDefault() :
            this.param.type.getDefault();
    this.value = this.param.defaultValue;
    this.arg = undefined;
};
Assignment.prototype = {
    /**
     * The parameter that we are assigning to
     * @readonly
     */
    param: undefined,

    /**
     * Report on the status of the last parse() conversion.
     * @see types.Conversion
     */
    conversion: undefined,

    /**
     * The current value in a type as specified by param.type
     */
    value: undefined,

    /**
     * The string version of the current value
     */
    arg: undefined,

    /**
     * The current value (i.e. not the string representation)
     * Use setValue() to mutate
     */
    value: undefined,
    setValue: function(value) {
        if (this.value === value) {
            return;
        }

        if (value === undefined) {
            this.value = this.param.defaultValue;
            this.conversion = this.param.getDefault ?
                    this.param.getDefault() :
                    this.param.type.getDefault();
            this.arg = undefined;
        } else {
            this.value = value;
            this.conversion = undefined;
            var text = (value == null) ? '' : this.param.type.stringify(value);
            this.arg.text = text;
        }

        var ev = { assignment: this };
        this._dispatchEvent('assignmentChange', ev);
    },

    /**
     * The textual representation of the current value
     * Use setArgument() or setText() to mutate
     */
    arg: undefined,
    setArgument: function(arg) {
        if (this.arg === arg) {
            return;
        }

        this.arg = arg;
        this.conversion = this.param.type.parse(arg.text);

        if (this.value === this.conversion.value) {
            return;
        }

        this.value = this.conversion.value;

        var ev = { assignment: this };
        this._dispatchEvent('assignmentChange', ev);
    },

    setText: function(text) {
        if (text == null) {
            throw new Error('Illegal text for Argument: ' + text);
        }
        this.arg.text = text;

        var ev = { assignment: this };
        this._dispatchEvent('assignmentChange', ev);
    },

    /**
     * Create a hints associated with this parameter assignment.
     */
    getHint: function() {
        // Allow the parameter to provide documentation
        if (this.param.getCustomHint && this.value && this.arg) {
            var hint = this.param.getCustomHint(this.value, this.arg);
            if (hint) {
                return hint;
            }
        }

        var hint = new Hint();
        hint.paramIndex = this.paramIndex;

        // If there is no argument, use the cursor position
        if (this.param.description) {
            // TODO: This should be a short description - do we need to trim?
            // Remove closing '.'
            var desc = this.param.description.trim();
            if (desc.slice(-1) === '.') {
                desc = desc.slice(0, -1);
            }
            hint.message += '<strong>' + desc + '</strong>: ';
        }
        else {
            hint.message += '<strong>' + this.param.name + '</strong>: ';
        }

        // Hint if the param is required, but not provided
        var argProvided = this.arg && this.arg.text !== '';
        var dataProvided = this.value !== undefined || argProvided;
        if (this.param.defaultValue === undefined && !dataProvided) {
            hint.status = Status.ERROR;
            hint.message += '(Required) ';
        }

        if (this.arg) {
            hint.start = this.arg.start;
            hint.end = this.arg.end;
        }

        // Non-valid conversions will have useful information to pass on
        if (this.conversion) {
            hint.status = this.conversion.status;
            if (this.conversion.message) {
                hint.message += this.conversion.message;
            }
            hint.predictions = this.conversion.predictions;
        }

        return hint;
    },

    getMessage: function() {
        if (this.conversion && this.conversion.message) {
            return this.conversion.message;
        }
        return '';
    },

    getPredictions: function() {
        if (this.conversion && this.conversion.predictions) {
            return this.conversion.predictions;
        }
        return [];
    },

    /**
     * Basically <tt>setValue(conversion.predictions[0])</tt> done in a safe
     * way.
     */
    complete: function() {
        if (this.conversion && this.conversion.predictions &&
                this.conversion.predictions.length > 0) {
            this.setValue(this.conversion.predictions[0]);
        }
    },

    /**
     * If the cursor is at 'position', do we have sufficient data to start
     * displaying the next hint? This is both complex and important.
     *
     * <p>For example, if the user has just typed:<ul>
     * <li>'set tabstop ' then they clearly want to know about the valid
     *     values for the tabstop setting, so the hint is based on the next
     *     parameter.
     * <li>'set tabstop' (without trailing space) - they will probably still
     *     want to know about the valid values for the tabstop setting because
     *     there is no confusion about the setting in question.
     * <li>'set tabsto' they've not finished typing a setting name so the hint
     *     should be based on the current parameter.
     * <li>'set tabstop' (when there is an additional tabstopstyle setting) we
     *     can't make assumptions about the setting - we're not finished.
     * </ul>
     * <p>Note that the input for 2 and 4 is identical, only the configuration
     * has changed, so which hint we display depends on the environment.
     *
     * <p>This function works out if the cursor is before the end of this
     * assignment (assuming that we've asked the same thing of the previous
     * assignment) and then attempts to work out if we should use the hint from
     * the next assignment even though technically the cursor is still inside
     * this one due to the rules above.
     *
     * <p>Also, the logic above is good for hints. If we're taking about what
     * to do when the user presses up/down, then we always 'capture' if the
     * cursor is at the end position.
     *
     * @param {number} cursor The cursor position to query
     * @param {boolean} endIsPrev If the cursor is at the end of a parameter and
     * cursor up/down is pressed, then we work on the existing parameter,
     * however for hint purposes we may say were on the next parameter.
     */
    _isPositionCaptured: function(cursor, endIsPrev) {
        if (!this.arg) {
            return false;
        }

        // Note we don't check if position >= this.arg.start because that's
        // implied by the fact that we're asking the assignments in turn, and
        // we want to avoid thing falling between the cracks

        // If the arg is at the cursor we're clearly captured
        if (this.arg.start === Argument.AT_CURSOR) {
            return true;
        }

        // We're clearly done if the position is past the end of the text
        if (cursor > this.arg.end) {
            return false;
        }

        // If we're AT the end, the position is captured if either the status
        // is not valid or if there are other valid options including current
        if (cursor === this.arg.end) {
            if (endIsPrev) {
                return true;
            }

            return this.conversion.status !== Status.VALID ||
                    this.conversion.predictions.length !== 0;
        }

        // Otherwise we're clearly inside
        return true;
    },

    /**
     * Replace the current value with the lower value if such a concept
     * exists.
     */
    decrement: function() {
        var replacement = this.param.type.decrement(this.value);
        if (replacement != null) {
            this.setValue(replacement);
        }
    },

    /**
     * Replace the current value with the higher value if such a concept
     * exists.
     */
    increment: function() {
        var replacement = this.param.type.increment(this.value);
        if (replacement != null) {
            this.setValue(replacement);
        }
    },

    /**
     * Helper when we're rebuilding command lines.
     */
    toString: function() {
        return this.arg ? this.arg.toString() : '';
    }
};
oop.implement(Assignment.prototype, EventEmitter);
exports.Assignment = Assignment;


/**
 * This is a special parameter to reflect the command itself.
 */
var commandParam = {
    name: '__command',
    type: 'command',
    description: 'The command to execute',

    /**
     * Provide some documentation for a command.
     */
    getCustomHint: function(command, arg) {
        var docs = [];
        docs.push('<strong><tt> &gt; ');
        docs.push(command.name);
        if (command.params.length > 0) {
            command.params.forEach(function(param) {
                if (param.defaultValue === undefined) {
                    docs.push(' [' + param.name + ']');
                }
                else {
                    docs.push(' <em>[' + param.name + ']</em>');
                }
            }, this);
        }
        docs.push('</tt></strong><br/>');

        docs.push(command.description ? command.description : '(No description)');
        docs.push('<br/>');

        if (command.params.length > 0) {
            docs.push('<ul>');
            command.params.forEach(function(param) {
                docs.push('<li>');
                docs.push('<strong><tt>' + param.name + '</tt></strong>: ');
                docs.push(param.description ? param.description : '(No description)');
                if (param.defaultValue === undefined) {
                    docs.push(' <em>[Required]</em>');
                }
                else if (param.defaultValue === null) {
                    docs.push(' <em>[Optional]</em>');
                }
                else {
                    docs.push(' <em>[Default: ' + param.defaultValue + ']</em>');
                }
                docs.push('</li>');
            }, this);
            docs.push('</ul>');
        }

        // If this is a parent of a sub-command and the problem is with the
        // command parameter, we're not done
        var status = command.exec ? Status.VALID : Status.INCOMPLETE;
        return new Hint(status, docs.join(''), 0, arg);
    }
};

/**
 * A Requisition collects the information needed to execute a command.
 * There is no point in a requisition for parameter-less commands because there
 * is no information to collect. A Requisition is a collection of assignments
 * of values to parameters, each handled by an instance of Assignment.
 * CliRequisition adds functions for parsing input from a command line to this
 * class.
 *
 * <h2>Events<h2>
 * Requisition publishes the following event:<ul>
 * <li>commandChange: The command has changed. It is likely that a UI
 * structure will need updating to match the parameters of the new command.
 * The event object looks like { command: A }
 * </ul>
 * @constructor
 */
function Requisition(env) {
    this.env = env;
    this.commandAssignment = new Assignment(commandParam, 0);

    var listener = this._commandAssignmentChanged.bind(this);
    this.commandAssignment.addEventListener('assignmentChange', listener);

    this._assignments = {};
    this.assignmentCount = 0;

    this._hints = [];
}
Requisition.prototype = {
    /**
     * The command that we are about to execute.
     * @see setCommandConversion()
     * @readonly
     */
    commandAssignment: undefined,

    /**
     * The count of assignments. Excludes the commandAssignment
     * @readonly
     */
    assignmentCount: undefined,

    /**
     * The object that stores of Assignment objects that we are filling out.
     * The Assignment objects are stored under their param.name for named
     * lookup. Note: We make use of the property of Javascript objects that
     * they are not just hashmaps, but linked-list hashmaps which iterate in
     * insertion order.
     * Excludes the commandAssignment.
     */
    _assignments: undefined,

    /**
     * The store of hints generated by the assignments. We are trying to prevent
     * the UI from needing to access this in broad form, but instead use
     * methods that query part of this structure.
     */
    _hints: undefined,

    /**
     * When the command changes, we need to keep a bunch of stuff in sync
     */
    _commandAssignmentChanged: function() {
        this._assignments = {};
        var command = this.commandAssignment.value;
        if (command) {
            for (var i = 0; i < command.params.length; i++) {
                var param = command.params[i];
                this._assignments[param.name] = new Assignment(param, i);
            }
        }
        this.assignmentCount = Object.keys(this._assignments).length;

        this._dispatchEvent('commandChange', { command: command });
    },

    /**
     * We populate assignments with an empty argument when there is nothing
     * provided by the user because we need to support TAB completions (etc) and
     * update the command line
     */
    createEmptyArgument: function() {
        return new Argument('', Argument.AT_CURSOR, Argument.AT_CURSOR, '', '');
    },

    /**
     * Assignments have an order, so we need to store them in an array.
     * But we also need named access ...
     */
    getAssignment: function(nameOrNumber) {
        var name = (typeof nameOrNumber === 'string') ?
            nameOrNumber :
            Object.keys(this._assignments)[nameOrNumber];
        return this._assignments[name];
    },

    /**
     * Where parameter name == assignment names - they are the same.
     */
    getParameterNames: function() {
        return Object.keys(this._assignments);
    },

    /**
     * A *shallow* clone of the assignments.
     * This is useful for systems that wish to go over all the assignments
     * finding values one way or another and wish to trim an array as they go.
     */
    cloneAssignments: function() {
        return Object.keys(this._assignments).map(function(name) {
            return this._assignments[name];
        }, this);
    },

    /**
     * Collect the statuses from the Assignments.
     * The hints returned are sorted by severity
     */
    _updateHints: function() {
        // TODO: work out when to clear this out for the plain Requisition case
        // this._hints = [];
        this.getAssignments(true).forEach(function(assignment) {
            this._hints.push(assignment.getHint());
        }, this);
    },

    /**
     * Returns the most severe status
     */
    getStatus: function() {
        var status = Status.VALID;
        this.getAssignments(true).forEach(function(assignment) {
            if (assignment.conversion.status > status) {
                status = assignment.conversion.status;
            }
        }, this);
        return status;
    },

    /**
     * Extract the names and values of all the assignments, and return as
     * an object.
     */
    getArgsObject: function() {
        var args = {};
        this.getAssignments().forEach(function(assignment) {
            args[assignment.param.name] = assignment.value;
        }, this);
        return args;
    },

    /**
     * Access the arguments as an array.
     * @param includeCommand By default only the parameter arguments are
     * returned unless (includeCommand === true), in which case the list is
     * prepended with commandAssignment.arg
     */
    getAssignments: function(includeCommand) {
        var assignments = [];
        if (includeCommand === true) {
            assignments.push(this.commandAssignment);
        }
        Object.keys(this._assignments).forEach(function(name) {
            assignments.push(this.getAssignment(name));
        }, this);
        return assignments;
    },

    /**
     * Reset all the assignments to their default values
     */
    setDefaultValues: function() {
        this.getAssignments().forEach(function(assignment) {
            assignment.setArgument(this.createEmptyArgument());
        }, this);
    },

    /**
     * Helper to call canon.exec
     */
    exec: function() {
        canon.exec(this.commandAssignment.value,
              this.env,
              this.getArgsObject(),
              this.toCanonicalString());
    },

    /**
     * Extract a canonical version of the input
     */
    toCanonicalString: function() {
        var line = [];
        line.push(this.commandAssignment.value.name);
        Object.keys(this._assignments).forEach(function(name) {
            var assignment = this._assignments[name];
            var type = assignment.param.type;
            // TODO: This will cause problems if there is a non-default value
            // after a default value. Also we need to decide when to use
            // named parameters in place of positional params. Both can wait.
            if (assignment.value !== assignment.param.defaultValue) {
                line.push(' ');
                line.push(type.stringify(assignment.value));
            }
        }, this);
        return line.join('');
    }
};
oop.implement(Requisition.prototype, EventEmitter);
exports.Requisition = Requisition;


/**
 * An object used during command line parsing to hold the various intermediate
 * data steps.
 * <p>The 'output' of the update is held in 2 objects: input.hints which is an
 * array of hints to display to the user. In the future this will become a
 * single value.
 * <p>The other output value is input.requisition which gives access to an
 * args object for use in executing the final command.
 *
 * <p>The majority of the functions in this class are called in sequence by the
 * constructor. Their task is to add to <tt>hints</tt> fill out the requisition.
 * <p>The general sequence is:<ul>
 * <li>_tokenize(): convert _typed into _parts
 * <li>_split(): convert _parts into _command and _unparsedArgs
 * <li>_assign(): convert _unparsedArgs into requisition
 * </ul>
 *
 * @param typed {string} The instruction as typed by the user so far
 * @param options {object} A list of optional named parameters. Can be any of:
 * <b>flags</b>: Flags for us to check against the predicates specified with the
 * commands. Defaulted to <tt>keyboard.buildFlags({ });</tt>
 * if not specified.
 * @constructor
 */
function CliRequisition(env, options) {
    Requisition.call(this, env);

    // Used to store cli arguments that were not assigned to parameters
    this.unassigned = null;
}
oop.inherits(CliRequisition, Requisition);
(function() {
    /**
     * Called by the UI when ever the user interacts with a command line input
     * @param input A structure that details the state of the input field.
     * It should look something like: { typed:a, cursor: { start:b, end:c } }
     * Where a is the contents of the input field, and b and c are the start
     * and end of the cursor/selection respectively.
     */
    CliRequisition.prototype.update = function(input) {
        this.input = input;
        this._hints = [];

        var args = this._tokenize(input.typed);
        this._split(args);
        this._assign(args);
        this._updateHints();
    };

    /**
     * Return an array of Status scores so we can create a marked up
     * version of the command line input.
     */
    CliRequisition.prototype.getInputStatusMarkup = function() {
        // 'scores' is an array which tells us what chars are errors
        // Initialize with everything VALID
        var scores = this.toString().split('').map(function(ch) {
            return Status.VALID;
        });
        // For all chars in all hints, check and upgrade the score
        this._hints.forEach(function(hint) {
            for (var i = hint.start; i < hint.end; i++) {
                if (hint.status > scores[i]) {
                    scores[i] = hint.status;
                }
            }
        }, this);
        return scores;
    };

    /**
     * Reconstitute the input from the args
     */
    CliRequisition.prototype.toString = function() {
        var reply = this.getAssignments(true).map(function(assignment) {
            return assignment.toString();
        }, this).join('');

        if (this.unassigned) {
            reply += this.unassigned;
        }
        return reply;
    };

    var superUpdateHints = CliRequisition.prototype._updateHints;
    /**
     * Marks up hints in a number of ways:
     * - Makes INCOMPLETE hints that are not near the cursor ERROR since
     *   they can't be completed by typing
     * - Finds the most severe hint, and annotates the array with it
     * - Finds the hint to display, and also annotates the array with it
     * TODO: I'm wondering if array annotation is evil and we should replace
     * this with an object. Need to find out more.
     */
    CliRequisition.prototype._updateHints = function() {
        superUpdateHints.call(this);

        if (this.unassigned) {
            var command = this.commandAssignment.value;
            var msg = this.unassigned.start === 0 || !command ?
                'Input \'' + this.unassigned.text + '\' makes no sense.' :
                command.name + ' does not take any parameters';

            // The paramIndex is -1 because this argument has no parameter
            // to be assigned to.
            this._hints.push(new Hint(Status.ERROR, msg, -1, this.unassigned));
        }

        // ## Hint status escalation
        var c = this.input.cursor;
        this._hints.forEach(function(hint) {
            // Incomplete hints are actually errors unless the cursor is inside
            // A normal Requisition doesn't know about cursors so this must be
            // done here
            var startInHint = c.start >= hint.start && c.start <= hint.end;
            var endInHint = c.end >= hint.start && c.end <= hint.end;
            var inHint = startInHint || endInHint;
            // The exception is sub-commands, where the parent command is made
            // complete by the addition of a sub-command. In this case we should
            // leave the status as INCOMPLETE. We don't have an easy way to
            // detect if the status is from a parent command, so we just skip
            // the escalation when hint.start == 0
            var atStart = hint.start === 0;
            if (!inHint && !atStart && hint.status === Status.INCOMPLETE) {
                hint.status = Status.ERROR;
            }
        }, this);
    };

    /**
     * Look through the arguments attached to our assignments for the assignment
     * at the given position.
     * TODO: Currently endIsPrev is always true. Cleanup needed.
     * @param {number} cursor The cursor position to query
     * @param {boolean} endIsPrev If the cursor is at the end of a parameter and
     * cursor up/down is pressed, then we work on the existing parameter,
     * however for hint purposes we may say were on the next parameter.
     * @see Assignment.prototype._isPositionCaptured
     */
    CliRequisition.prototype.getAssignmentAt = function(cursor, endIsPrev) {
        var assignments = this.getAssignments(true);
        for (var i = 0; i < assignments.length; i++) {
            var assignment = assignments[i];
            // If there is no typed argument in this assignment, we've fallen
            // off the end of the obvious answers - it must be this one.
            if (assignment.arg.start === Argument.AT_CURSOR) {
                return assignment;
            }
            if (assignment._isPositionCaptured(cursor, endIsPrev)) {
                return assignment;
            }
        }

        return assignment;
    };

    /**
     * Split up the input taking into account ' and "
     */
    CliRequisition.prototype._tokenize = function(typed) {
        // For blank input, place a dummy empty argument into the list
        if (typed == null || typed.length === 0) {
            return [ new Argument('', 0, 0, '', '') ];
        }

        var OUTSIDE = 1;     // The last character was whitespace
        var IN_SIMPLE = 2;   // The last character was part of a parameter
        var IN_SINGLE_Q = 3; // We're inside a single quote: '
        var IN_DOUBLE_Q = 4; // We're inside double quotes: "

        var mode = OUTSIDE;

        // First we un-escape. This list was taken from:
        // https://developer.mozilla.org/en/Core_JavaScript_1.5_Guide/Core_Language_Features#Unicode
        // We are generally converting to their real values except for \', \"
        // and '\ ' which we are converting to unicode private characters so we
        // can distinguish them from ', " and ' ', which have special meaning.
        // They need swapping back post-split - see unescape2()
        typed = typed
                .replace(/\\\\/g, '\\')
                .replace(/\\b/g, '\b')
                .replace(/\\f/g, '\f')
                .replace(/\\n/g, '\n')
                .replace(/\\r/g, '\r')
                .replace(/\\t/g, '\t')
                .replace(/\\v/g, '\v')
                .replace(/\\n/g, '\n')
                .replace(/\\r/g, '\r')
                .replace(/\\ /g, '\uF000')
                .replace(/\\'/g, '\uF001')
                .replace(/\\"/g, '\uF002');

        function unescape2(str) {
            return str
                .replace(/\uF000/g, ' ')
                .replace(/\uF001/g, '\'')
                .replace(/\uF002/g, '"');
        }

        var i = 0; // The index of the current character
        var start = 0; // Where did this section start?
        var prefix = ''; // Stuff that comes before the current argument
        var args = [];

        while (true) {
            if (i >= typed.length) {
                // There is nothing else to read - tidy up
                if (mode !== OUTSIDE) {
                    var str = unescape2(typed.substring(start, i));
                    args.push(new Argument(str, start, i, prefix, ''));
                }
                else {
                    if (i !== start) {
                        // There's a bunch of whitespace at the end of the
                        // command add it to the last argument's suffix,
                        // creating an empty argument if needed.
                        var extra = typed.substring(start, i);
                        var lastArg = args[args.length - 1];
                        if (!lastArg) {
                            args.push(new Argument('', i, i, extra, ''));
                        }
                        else {
                            lastArg.suffix += extra;
                        }
                    }
                }
                break;
            }

            var c = typed[i];
            switch (mode) {
                case OUTSIDE:
                    if (c === '\'') {
                        prefix = typed.substring(start, i + 1);
                        mode = IN_SINGLE_Q;
                        start = i + 1;
                    }
                    else if (c === '"') {
                        prefix = typed.substring(start, i + 1);
                        mode = IN_DOUBLE_Q;
                        start = i + 1;
                    }
                    else if (/ /.test(c)) {
                        // Still whitespace, do nothing
                    }
                    else {
                        prefix = typed.substring(start, i);
                        mode = IN_SIMPLE;
                        start = i;
                    }
                    break;

                case IN_SIMPLE:
                    // There is an edge case of xx'xx which we are assuming to
                    // be a single parameter (and same with ")
                    if (c === ' ') {
                        var str = unescape2(typed.substring(start, i));
                        args.push(new Argument(str, start, i, prefix, ''));
                        mode = OUTSIDE;
                        start = i;
                        prefix = '';
                    }
                    break;

                case IN_SINGLE_Q:
                    if (c === '\'') {
                        var str = unescape2(typed.substring(start, i));
                        args.push(new Argument(str,
                                start - 1, i + 1, prefix, c));
                        mode = OUTSIDE;
                        start = i + 1;
                        prefix = '';
                    }
                    break;

                case IN_DOUBLE_Q:
                    if (c === '"') {
                        var str = unescape2(typed.substring(start, i));
                        args.push(new Argument(str,
                                start - 1, i + 1, prefix, c));
                        mode = OUTSIDE;
                        start = i + 1;
                        prefix = '';
                    }
                    break;
            }

            i++;
        }

        return args;
    };

    /**
     * Looks in the canon for a command extension that matches what has been
     * typed at the command line.
     */
    CliRequisition.prototype._split = function(args) {
        var argsUsed = 1;
        var arg;

        while (argsUsed <= args.length) {
            arg = Argument.merge(args, 0, argsUsed);
            var conversion = this.commandAssignment.param.type.parse(arg.text);

            // We only want to carry on if this command is a parent command,
            // which means that there is a commandAssignment, but not one with
            // an exec function.
            if (!conversion.value || conversion.value.exec) {
                break;
            }

            // Previously we needed a way to hide commands depending context.
            // We have not resurrected that feature yet, but if we do we should
            // insert code here to ignore certain commands depending on the
            // context/environment

            argsUsed++;
        }

        this.commandAssignment.setArgument(arg);

        for (var i = 0; i < argsUsed; i++) {
            args.shift();
        }

        // TODO: This could probably be re-written to consume args as we go
    };

    /**
     * Work out which arguments are applicable to which parameters.
     * <p>This takes #_command.params and #_unparsedArgs and creates a map of
     * param names to 'assignment' objects, which have the following properties:
     * <ul>
     * <li>param - The matching parameter.
     * <li>index - Zero based index into where the match came from on the input
     * <li>value - The matching input
     * </ul>
     */
    CliRequisition.prototype._assign = function(args) {
        if (!this.commandAssignment.value) {
            this.unassigned = Argument.merge(args);
            return;
        }

        this.unassigned = null;
        if (args.length === 0) {
            this.setDefaultValues();
            return;
        }

        // Create an error if the command does not take parameters, but we have
        // been given them ...
        if (this.assignmentCount === 0) {
            this.unassigned = Argument.merge(args);
            return;
        }

        // Special case: if there is only 1 parameter, and that's of type
        // text we put all the params into the first param
        if (this.assignmentCount === 1) {
            var assignment = this.getAssignment(0);
            if (assignment.param.type.name === 'text') {
                assignment.setArgument(Argument.merge(args));
                return;
            }
        }

        // TODO: no good reason for this to be a clone?
        var assignments = this.cloneAssignments();
        var names = this.getParameterNames();

        // Extract all the named parameters
        var used = [];
        assignments.forEach(function(assignment) {
            var namedArgText = '--' + assignment.name;

            // Loop over the arguments - not a for loop because we remove
            // processed arguments as we go
            var i = 0;
            while (true) {
                var arg = args[i];
                if (namedArgText !== arg.text) {
                    i++;
                    if (i >= args.length) {
                        break;
                    }
                    continue;
                }

                // boolean parameters don't have values, default to false
                if (assignment.param.type.name === 'boolean') {
                    // TODO: Using setValue works, but it doesn't leave the
                    // assignment with traceability to where the parameter came
                    // from, so later mutations are likely to break. Fix this
                    assignment.setValue(true);
                }
                else {
                    if (i + 1 < args.length) {
                        // Missing value portion of this named param
                        assignment.setArgument(this.createEmptyArgument());
                    }
                    else {
                        // TODO: We need a setNamedArgument() because the
                        // assignment needs to know both the value and the
                        // extent of both the arguments so replacement can
                        // work. Same for the boolean case above
                        args.splice(i + 1, 1);
                        assignment.setArgument(args[i + 1]);
                    }
                }

                lang.arrayRemove(names, assignment.name);
                args.splice(i, 1);
                // We don't need to i++ if we splice
            }
        }, this);

        // What's left are positional parameters assign in order
        names.forEach(function(name) {
            var arg = (args.length > 0) ?
                args.splice(0, 1)[0] :
                this.createEmptyArgument();
            this.getAssignment(name).setArgument(arg);
        }, this);

        if (args.length > 0) {
            this.unassigned = Argument.merge(args);
        }
    };

})();
exports.CliRequisition = CliRequisition;


});