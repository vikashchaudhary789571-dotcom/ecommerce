// In a real application with a database (like MongoDB or SQL), 
// this file would define the schema.
// Since we are starting with mock data, this model represents the structure.

class Transaction {
    constructor(id, date, description, debit, credit, balance) {
        this.id = id;
        this.date = date;
        this.description = description;
        this.debit = debit;
        this.credit = credit;
        this.balance = balance;
    }
}

module.exports = Transaction;
