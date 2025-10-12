import { Entity, PrimaryColumn, Column, CreateDateColumn, PrimaryGeneratedColumn } from "typeorm";
import { OneToMany } from "typeorm";
import { ChatSession } from "./chat_session.entity";

@Entity('users')
export class User {

    @PrimaryGeneratedColumn('uuid')
    id: string;

    @OneToMany(() => ChatSession, (session) => session.user)
    chatSessions: ChatSession[];

    @Column({ length: 100 })
    name: string;

    @Column()
    password: string;

    @Column({ length: 150, unique: true })
    email: string;

    @Column({ length: 50, nullable: true })
    role: string;

    @Column({ length: 100, nullable: true })
    department: string;

    @CreateDateColumn()
    created_at: Date;

}